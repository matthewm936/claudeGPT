import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { parseExportFiles, buildTriageQueue, prepareForSummary } from './parse-export.js';
import { summarizeAll } from './summarize-worker.js';
import { buildIngestionBatches, processAllBatches, runSynthesis } from './import-worker-pool.js';
import * as profiles from './profiles.js';
import * as checkpoint from './import-checkpoint.js';

let importSession = null;

export function getSession() { return importSession; }
export function clearSession() { importSession = null; }

function importDir(profilesDir) {
  const userDir = profiles.getDir(profilesDir);
  return path.join(userDir, 'data', 'imports', 'chatgpt');
}

export function extractExportFiles(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const TEXT_EXTS = ['.json', '.html', '.htm', '.txt', '.md', '.csv'];
  const MAX_SIZE = 10 * 1024 * 1024;
  const files = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const ext = path.extname(entry.entryName).toLowerCase();
    if (!TEXT_EXTS.includes(ext) || entry.header.size > MAX_SIZE) continue;
    try {
      const content = entry.getData().toString('utf-8');
      if (content.trim().length > 0) files.push({ name: entry.entryName, content, size: content.length });
    } catch {}
  }

  if (files.length === 0) throw new Error('No readable files found in zip');
  return files;
}

// --- Re-parse zip from disk (for resume) ---

function reparseZip(profilesDir) {
  const zipPath = path.join(importDir(profilesDir), 'export.zip');
  if (!fs.existsSync(zipPath)) return null;
  const buf = fs.readFileSync(zipPath);
  const files = extractExportFiles(buf);
  const conversations = parseExportFiles(files);
  const { triageQueue, preSkipped } = buildTriageQueue(conversations);
  return { files, conversations, triageQueue, preSkipped };
}

// --- Upload + Triage ---

export async function handleUploadExport(ws, data, profilesDir) {
  const buf = Buffer.from(data, 'base64');
  const dir = importDir(profilesDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'export.zip'), buf);

  // Clear any old checkpoint
  checkpoint.clear(dir);

  const files = extractExportFiles(buf);
  console.log(`[import] Extracted ${files.length} files from zip (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
  const conversations = parseExportFiles(files);
  console.log(`[import] Parsed ${conversations.length} conversations from ${files.filter(f => f.name.endsWith('.json')).length} JSON files`);
  const { triageQueue, preSkipped, preSkipStats } = buildTriageQueue(conversations);
  console.log(`[import] Triage queue: ${triageQueue.length} for Haiku, ${preSkipped.length} pre-skipped (short=${preSkipStats.too_short}, code=${preSkipStats.code_heavy}, impersonal=${preSkipStats.no_personal})`);

  // Pre-skipped conversations get auto-decided as 'skip'
  const decisions = new Map();
  for (const c of preSkipped) decisions.set(c.id, 'skip');

  importSession = {
    conversations,
    triageQueue,
    conversationMap: new Map(conversations.map(c => [c.id, c])),
    decisions,
    askItems: new Map(),
    triageResults: [],  // full triage items for checkpoint
    abortController: new AbortController(),
  };

  ws.send(JSON.stringify({
    type: 'import_parsed',
    totalFiles: files.length,
    totalConversations: triageQueue.length + preSkipped.length,
    preSkipped: preSkipped.length,
    preSkipStats,
    totalSize: triageQueue.reduce((s, c) => s + c.stats.userCharCount, 0),
  }));

  ws.send(JSON.stringify({ type: 'import_progress', phase: 'summarizing', total: triageQueue.length, summarized: 0 }));

  const summaryItems = triageQueue.map(c => prepareForSummary(c));

  await summarizeAll(summaryItems, {
    onBatchStart: (items) => {
      if (ws.readyState !== 1) return;
      for (const item of items) {
        ws.send(JSON.stringify({ type: 'triage_reading', id: item.id, title: item.title, date: item.date }));
      }
    },
    onBatchComplete: (results) => {
      if (ws.readyState !== 1) return;
      for (const item of results) {
        if (item.decision === 'keep' || item.decision === 'skip') {
          importSession.decisions.set(item.id, item.decision);
        } else if (item.decision === 'ask') {
          importSession.askItems.set(item.id, { reason: item.reason, resolved: false });
        }
        importSession.triageResults.push(item);
        ws.send(JSON.stringify({ type: 'triage_item', ...item }));
      }
    },
    onProgress: ({ summarized, total }) => {
      if (ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: 'import_progress', phase: 'summarizing', summarized, total }));
    },
    onError: (msg) => {
      console.error('Summarization error:', msg);
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'import_error', message: msg }));
    },
    signal: importSession.abortController.signal,
  });

  // Save checkpoint after triage — the expensive part is done
  checkpoint.save(importDir(profilesDir), 'triage_complete', {
    totalConversations: triageQueue.length,
    triageItems: importSession.triageResults,
    decisions: Object.fromEntries(importSession.decisions),
    askItems: Object.fromEntries(
      [...importSession.askItems].map(([k, v]) => [k, v])
    ),
  });

  ws.send(JSON.stringify({ type: 'triage_complete', total: triageQueue.length }));

  if (importSession.askItems.size === 0) {
    ws.send(JSON.stringify({ type: 'triage_ready' }));
  }
}

// --- Resume from checkpoint ---

export function checkForCheckpoint(profilesDir) {
  const dir = importDir(profilesDir);
  return checkpoint.load(dir);
}

export function resumeFromCheckpoint(ws, profilesDir) {
  const dir = importDir(profilesDir);
  const cp = checkpoint.load(dir);
  if (!cp) return false;

  // Re-parse zip to get full conversation data
  const parsed = reparseZip(profilesDir);
  if (!parsed) {
    checkpoint.clear(dir);
    return false;
  }

  // Reconstruct session from zip + checkpoint decisions
  importSession = {
    conversations: parsed.conversations,
    triageQueue: parsed.triageQueue,
    conversationMap: new Map(parsed.conversations.map(c => [c.id, c])),
    decisions: new Map(Object.entries(cp.decisions || {})),
    askItems: new Map(Object.entries(cp.askItems || {})),
    abortController: new AbortController(),
  };

  // Send checkpoint data to client
  ws.send(JSON.stringify({
    type: 'import_checkpoint',
    phase: cp.phase,
    totalConversations: cp.totalConversations,
    triageItems: cp.triageItems || [],
    decisions: cp.decisions || {},
    askItems: cp.askItems || {},
  }));

  return true;
}

export function overrideDecision(id, newDecision) {
  if (!importSession) return;
  importSession.decisions.set(id, newDecision);
  if (importSession.askItems.has(id)) {
    importSession.askItems.get(id).resolved = true;
  }
}

export function allAsksResolved() {
  if (!importSession) return false;
  for (const [, ask] of importSession.askItems) {
    if (!ask.resolved) return false;
  }
  return true;
}

export function getConversationText(id) {
  if (!importSession) return null;
  const conv = importSession.conversationMap.get(id);
  if (!conv) return null;
  return {
    id: conv.id,
    title: conv.title,
    date: conv.createTime ? conv.createTime.toISOString().split('T')[0] : null,
    fullText: conv.fullText || '',
    userText: conv.userText || '',
    messageCount: conv.stats?.userMessageCount || 0,
  };
}

// --- Ingestion ---

export async function startIngest(ws, profilesDir) {
  if (!importSession) throw new Error('No import session active');

  const keepIds = [];
  for (const [id, d] of importSession.decisions) { if (d === 'keep') keepIds.push(id); }
  if (keepIds.length === 0) throw new Error('No conversations selected for ingestion');

  const keepConversations = keepIds.map(id => importSession.conversationMap.get(id)).filter(Boolean);
  const dir = importDir(profilesDir);

  // Preserve triageItems from the previous checkpoint so resume still works
  const prevCp = checkpoint.load(dir);
  checkpoint.save(dir, 'ingesting', {
    totalConversations: keepConversations.length,
    triageItems: prevCp?.triageItems || importSession.triageResults || [],
    decisions: Object.fromEntries(importSession.decisions),
    askItems: Object.fromEntries(
      [...(importSession.askItems || new Map())].map(([k, v]) => [k, v])
    ),
  });

  ws.send(JSON.stringify({ type: 'import_progress', phase: 'ingesting', totalConversations: keepConversations.length, completedBatches: 0, totalBatches: 0, totalFilesCreated: 0 }));

  const batches = buildIngestionBatches(keepConversations);
  ws.send(JSON.stringify({ type: 'import_progress', phase: 'ingesting', totalConversations: keepConversations.length, completedBatches: 0, totalBatches: batches.length, totalFilesCreated: 0 }));

  const profileDir = profiles.getDir(profilesDir);
  const results = await processAllBatches(batches, profileDir, {
    onFileCreated: (info) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'import_file_created', ...info })); },
    onToolActivity: (info) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'import_tool_activity', ...info })); },
    onBatchComplete: (result) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ingest_batch_complete', batchIndex: result.batchIndex, filesCreated: result.filesCreated.length, success: result.success })); },
    onProgress: (progress) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'import_progress', phase: 'ingesting', ...progress })); },
  }, importSession.abortController.signal);

  // Synthesis is best-effort
  ws.send(JSON.stringify({ type: 'import_progress', phase: 'synthesizing' }));
  try {
    await runSynthesis(batches.length, profileDir, importSession.abortController.signal);
  } catch (err) {
    console.error('[synthesis] failed (non-fatal):', err.message);
  }

  profiles.markOnboardingComplete(profilesDir);
  checkpoint.clear(dir);

  const totalFiles = results.reduce((s, r) => s + r.filesCreated.length, 0);
  const totalCost = results.reduce((s, r) => s + r.cost, 0);
  const failedBatches = results.filter(r => !r.success).length;

  ws.send(JSON.stringify({ type: 'import_complete', filesProcessed: totalFiles, conversationsIngested: keepConversations.length, costUsd: totalCost, failedBatches }));
  importSession = null;
}

export function abort(ws) {
  if (importSession) {
    importSession.abortController.abort();
    importSession = null;
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'import_aborted' }));
  }
}
