import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..');
const PROFILES_DIR = path.join(REPO_DIR, 'profiles');
const USER_LINK = path.join(REPO_DIR, 'user'); // runtime symlink for Claude CLI
const CONV_DIR = path.join(__dirname, 'conversations');

// --- Profile Management ---

let activeProfile = null; // in-memory state

fs.mkdirSync(PROFILES_DIR, { recursive: true });
fs.mkdirSync(CONV_DIR, { recursive: true });

function getUserDir() {
  return activeProfile ? path.join(PROFILES_DIR, activeProfile) : null;
}
function getInboxRaw() { return path.join(getUserDir(), 'data', 'inbox', 'raw'); }
function getInboxProcessed() { return path.join(getUserDir(), 'data', 'inbox', 'processed'); }
function getOnboardingMarker() { return path.join(getUserDir(), '.onboarding-complete'); }
function getImportDir() { return path.join(getUserDir(), 'data', 'imports', 'chatgpt'); }

function listProfiles() {
  return fs.readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => {
      const profileDir = path.join(PROFILES_DIR, e.name);
      const hasKB = fs.existsSync(path.join(profileDir, 'now.md'));
      const onboarded = fs.existsSync(path.join(profileDir, '.onboarding-complete')) || hasKB;
      return { name: e.name, hasKB, onboarded };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function createProfile(name) {
  const safe = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40);
  if (!safe) throw new Error('Invalid profile name');
  const profileDir = path.join(PROFILES_DIR, safe);
  if (fs.existsSync(profileDir)) throw new Error('Profile already exists');
  fs.mkdirSync(profileDir, { recursive: true });
  return safe;
}

function selectProfile(name) {
  const profileDir = path.join(PROFILES_DIR, name);
  if (!fs.existsSync(profileDir)) throw new Error('Profile not found');
  activeProfile = name;

  // Sync user/ symlink so Claude CLI (which reads CLAUDE.md) resolves user/ paths
  try { fs.unlinkSync(USER_LINK); } catch {}
  fs.symlinkSync(profileDir, USER_LINK);

  // Ensure inbox dirs exist
  [getInboxRaw(), getInboxProcessed()].forEach(d => fs.mkdirSync(d, { recursive: true }));
  return name;
}

function deleteProfile(name) {
  const profileDir = path.join(PROFILES_DIR, name);
  if (!fs.existsSync(profileDir)) throw new Error('Profile not found');
  fs.rmSync(profileDir, { recursive: true, force: true });

  // If we deleted the active profile, switch to another or clear
  if (activeProfile === name) {
    try { fs.unlinkSync(USER_LINK); } catch {}
    activeProfile = null;
    const remaining = listProfiles();
    if (remaining.length > 0) {
      selectProfile(remaining[0].name);
    }
  }
}

function getActiveProfile() { return activeProfile; }

// On startup: detect active profile from existing symlink or first available
function initProfile() {
  // Check existing symlink
  try {
    const stat = fs.lstatSync(USER_LINK);
    if (stat.isSymbolicLink()) {
      const target = path.basename(fs.readlinkSync(USER_LINK));
      if (fs.existsSync(path.join(PROFILES_DIR, target))) {
        activeProfile = target;
        return;
      }
    }
  } catch {}

  // Auto-select first profile if only one exists
  const profiles = listProfiles();
  if (profiles.length === 1) {
    selectProfile(profiles[0].name);
  }
}

initProfile();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Track active processes for abort
const activeProcesses = new Map();

// --- Conversation Storage ---

function loadConversation(id) {
  const file = path.join(CONV_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function saveConversation(conv) {
  conv.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(CONV_DIR, `${conv.id}.json`), JSON.stringify(conv, null, 2));
}

function listConversations() {
  const files = fs.readdirSync(CONV_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const conv = JSON.parse(fs.readFileSync(path.join(CONV_DIR, f), 'utf-8'));
    return {
      id: conv.id,
      title: conv.title,
      updatedAt: conv.updatedAt,
      messageCount: conv.messages.length,
    };
  }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function createConversation() {
  const conv = {
    id: uuidv4(),
    sessionId: null,
    title: 'New conversation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  saveConversation(conv);
  return conv;
}

// --- File Tree ---

function buildFileTree(dir, basePath = '') {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter(e => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    })
    .map(e => ({
      name: e.name,
      path: path.join(basePath, e.name),
      type: e.isDirectory() ? 'directory' : 'file',
      children: e.isDirectory()
        ? buildFileTree(path.join(dir, e.name), path.join(basePath, e.name))
        : undefined,
    }));
}

// --- Inbox ---

function getInboxItems() {
  const raw = fs.existsSync(getInboxRaw())
    ? fs.readdirSync(getInboxRaw()).filter(f => !f.startsWith('.')).map(f => ({ name: f, status: 'pending' }))
    : [];
  const processed = fs.existsSync(getInboxProcessed())
    ? fs.readdirSync(getInboxProcessed()).filter(f => !f.startsWith('.')).map(f => ({ name: f, status: 'processed' }))
    : [];
  return [...raw, ...processed];
}

// --- File Watcher ---

const clients = new Set();
let debounceTimer = null;

function broadcastFileTree() {
  const tree = buildFileTree(getUserDir());
  const msg = JSON.stringify({ type: 'file_tree_update', tree });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function broadcastInbox() {
  const items = getInboxItems();
  const msg = JSON.stringify({ type: 'inbox_update', items });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// File watcher — set up dynamically when profile changes
let fileWatcher = null;
function setupFileWatcher() {
  if (fileWatcher) { try { fileWatcher.close(); } catch {} }
  const dir = getUserDir();
  if (fs.existsSync(dir)) {
    fileWatcher = fs.watch(dir, { recursive: true }, () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        broadcastFileTree();
        broadcastInbox();
      }, 500);
    });
  }
}

// Set up watcher for initial profile if one is active
if (activeProfile) setupFileWatcher();

// --- Tool Detail Extraction ---

function extractToolDetail(name, input) {
  if (!input) return '';
  const shortPath = (p) => p ? p.replace(REPO_DIR + '/', '') : '';
  switch (name) {
    case 'Read': return shortPath(input.file_path);
    case 'Write': return shortPath(input.file_path);
    case 'Edit': return shortPath(input.file_path);
    case 'Bash': {
      const cmd = input.command || '';
      return cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
    }
    case 'Glob': return input.pattern || '';
    case 'Grep': {
      const p = input.pattern || '';
      return p.length > 50 ? p.slice(0, 47) + '...' : p;
    }
    case 'WebSearch': {
      const q = input.query || '';
      return q.length > 50 ? q.slice(0, 47) + '...' : q;
    }
    case 'TodoWrite': return '';
    default: return '';
  }
}

// --- Onboarding ---

function isOnboardingComplete() {
  return fs.existsSync(getOnboardingMarker()) || fs.existsSync(path.join(getUserDir(), 'now.md'));
}

function markOnboardingComplete() {
  fs.mkdirSync(getUserDir(), { recursive: true });
  fs.writeFileSync(getOnboardingMarker(), new Date().toISOString());
}

// --- Export Extractor ---

function extractExportFiles(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const TEXT_EXTS = ['.json', '.html', '.htm', '.txt', '.md', '.csv'];
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
  const files = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const ext = path.extname(entry.entryName).toLowerCase();
    if (!TEXT_EXTS.includes(ext)) continue;
    if (entry.header.size > MAX_FILE_SIZE) continue;

    try {
      const content = entry.getData().toString('utf-8');
      if (content.trim().length > 0) {
        files.push({ name: entry.entryName, content, size: content.length });
      }
    } catch {}
  }

  if (files.length === 0) throw new Error('No readable files found in zip');
  return files;
}

// --- Import Prompt Builder ---

function buildImportPrompt(files, batchIndex, totalBatches) {
  const fileTexts = files.map(f => {
    // Truncate very large files to keep prompt manageable
    const content = f.content.length > 200000
      ? f.content.slice(0, 200000) + '\n\n[...truncated...]'
      : f.content;
    return `=== FILE: ${f.name} (${f.size} bytes) ===\n\n${content}`;
  }).join('\n\n' + '='.repeat(60) + '\n\n');

  return `You are processing a data export to bootstrap this user's knowledge base. This is batch ${batchIndex + 1} of ${totalBatches}.

Below are files from the user's export (likely ChatGPT, but could be any format). Your job is to parse whatever format this is, extract everything that reveals who this person is, and file it into the KB.

If this is ChatGPT data (conversations.json or chat.html), parse the conversation structure and focus on the USER's messages — what they shared about their life, not the AI's responses.

For all content you find, identify and file:

1. **Journal-worthy content** → user/record/journal/YYYY-MM-DD.md (preserve the user's voice)
2. **People mentioned** → user/world/people/name.md (relationship context, dynamics)
3. **Goals, aspirations, plans** → user/active/goals/
4. **Decisions being weighed** → user/active/decisions/
5. **Creative work** (poems, stories, essays) → user/record/creative/
6. **Dreams** → user/record/dreams/
7. **Emotionally significant moments** → user/record/moments/
8. **Projects they're building** → user/world/projects/
9. **Philosophical positions, beliefs, values** → user/world/worldview/
10. **Patterns you notice** → user/understanding/patterns/ (create index.md if needed)
11. **Psychological insights** → user/understanding/insights/

Rules:
- Use dates from the data for filenames when available (YYYY-MM-DD format)
- Skip purely transactional content (code generation, simple Q&A, task delegation)
- Focus on substantive personal content — feelings, relationships, goals, reflections, creative work
- Preserve the user's actual words where they're vivid or revealing
- Don't file AI responses — only the user's content
- Merge related content (same person across conversations → one people file)

FILES TO PROCESS:

${fileTexts}`;
}

// --- Claude Import Runner ---

function runClaudeForImport(ws, prompt, sessionId) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      '--permission-mode', 'acceptEdits',
    ];

    if (sessionId) {
      args.push('--resume', sessionId);
    }

    args.push(prompt);

    const proc = spawn('claude', args, {
      cwd: REPO_DIR,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resultSessionId = sessionId;
    let sentToolIds = new Set();

    const rl = readline.createInterface({ input: proc.stdout });

    rl.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }

      if (msg.type === 'system' && msg.subtype === 'init') {
        resultSessionId = msg.session_id;
      } else if (msg.type === 'assistant') {
        const toolBlocks = (msg.message?.content || []).filter(b => b.type === 'tool_use');
        for (const block of toolBlocks) {
          if (block.id && !sentToolIds.has(block.id)) {
            sentToolIds.add(block.id);

            // Emit file creation events for Write/Edit tools
            if ((block.name === 'Write' || block.name === 'Edit') && block.input?.file_path) {
              const filePath = block.input.file_path.replace(REPO_DIR + '/', '');
              // Extract content snippet
              let snippet = '';
              if (block.name === 'Write' && block.input.content) {
                snippet = block.input.content.slice(0, 150);
              } else if (block.name === 'Edit' && block.input.new_string) {
                snippet = block.input.new_string.slice(0, 150);
              }

              if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'import_file_created',
                  filePath,
                  action: block.name === 'Write' ? 'created' : 'updated',
                  snippet,
                }));
              }
            }

            // Also send generic tool activity
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'import_tool_activity',
                tool: block.name,
                detail: extractToolDetail(block.name, block.input),
              }));
            }
          }
        }
      } else if (msg.type === 'result') {
        resultSessionId = msg.session_id || resultSessionId;
      }
    });

    proc.stderr.on('data', (data) => {
      console.error('[import stderr]', data.toString());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(resultSessionId);
      } else {
        reject(new Error(`Claude exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

// --- Import Orchestrator ---

async function processExportImport(ws, files) {
  // Batch files by cumulative size (~150KB per batch to stay within prompt limits)
  const MAX_BATCH_SIZE = 150 * 1024;
  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  for (const file of files) {
    if (currentSize + file.size > MAX_BATCH_SIZE && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(file);
    currentSize += file.size;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  let sessionId = null;
  let processedFiles = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'import_progress',
        batch: i + 1,
        totalBatches: batches.length,
        processedFiles,
        totalFiles: files.length,
        phase: 'processing',
      }));
    }

    const prompt = buildImportPrompt(batch, i, batches.length);

    try {
      sessionId = await runClaudeForImport(ws, prompt, sessionId);
      processedFiles += batch.length;
    } catch (err) {
      console.error(`Batch ${i + 1} failed:`, err.message);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'import_error',
          message: `Batch ${i + 1} failed: ${err.message}`,
        }));
      }
    }
  }

  // Final synthesis pass
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'import_progress',
      phase: 'synthesizing',
      processedFiles,
      totalFiles: files.length,
    }));
  }

  const synthesisPrompt = `You have now processed all the user's export data into their knowledge base. Do a final pass:

1. Read through everything you've filed so far (use the file tree to see what's there)
2. Create or update user/now.md with a living snapshot of where this person is right now, based on the most recent data
3. Create user/understanding/summary.md with a high-level synthesis of who this person is
4. Create user/understanding/psyche.md if you have enough data for a psychological architecture sketch
5. Create user/timeline.md with a chronological index of major events you found
6. Review user/understanding/patterns/ — add any cross-cutting patterns you noticed across multiple conversations

This is the foundation of the KB. Future conversations will build on what you've established here.`;

  try {
    await runClaudeForImport(ws, synthesisPrompt, sessionId);
  } catch (err) {
    console.error('Synthesis pass failed:', err.message);
  }

  markOnboardingComplete();

  if (ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'import_complete',
      filesProcessed: processedFiles,
    }));
  }
}

// --- Claude Code CLI Bridge ---

async function handleChat(ws, conversationId, text) {
  let conv = loadConversation(conversationId);
  if (!conv) {
    conv = createConversation();
    conv.id = conversationId;
    saveConversation(conv);
  }

  // Record user message
  conv.messages.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
  saveConversation(conv);

  // Build CLI args
  const args = [
    '-p',
    '--verbose',
    '--output-format', 'stream-json',
    '--permission-mode', 'acceptEdits',
  ];

  // Resume session if we have one
  if (conv.sessionId) {
    args.push('--resume', conv.sessionId);
  }

  // The prompt goes last
  args.push(text);

  const proc = spawn('claude', args, {
    cwd: REPO_DIR,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeProcesses.set(conversationId, proc);

  let toolsUsed = [];       // Array of { tool, detail } objects
  let sentToolIds = new Set();
  let sessionId = conv.sessionId;

  // Track assistant turns to filter out intermediate thinking text
  let turnText = '';        // Text accumulated in current assistant turn
  let turnHasTools = false; // Whether current turn has tool_use blocks
  let streamedText = '';    // Clean text sent to client (only from non-tool turns)

  // Parse NDJSON from stdout
  const rl = readline.createInterface({ input: proc.stdout });

  rl.on('line', (line) => {
    if (ws.readyState !== 1) return;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.type === 'system' && msg.subtype === 'init') {
      sessionId = msg.session_id;
    } else if (msg.type === 'assistant') {
      const content = msg.message?.content || [];
      const textBlocks = content.filter(b => b.type === 'text');
      const toolBlocks = content.filter(b => b.type === 'tool_use');

      const msgText = textBlocks.map(b => b.text || '').join('');

      // Detect new assistant turn (text length resets)
      if (msgText.length < turnText.length) {
        turnText = '';
        turnHasTools = false;
      }

      // If tool_use blocks appear, mark this turn as intermediate
      if (toolBlocks.length > 0 && !turnHasTools) {
        turnHasTools = true;
        // Undo any text we already streamed from this turn
        if (turnText.length > 0) {
          streamedText = streamedText.slice(0, streamedText.length - turnText.length);
          ws.send(JSON.stringify({ type: 'stream_reset', conversationId, text: streamedText }));
        }
      }

      // Only stream text from turns without tool use
      if (!turnHasTools) {
        const delta = msgText.slice(turnText.length);
        if (delta) {
          streamedText += delta;
          ws.send(JSON.stringify({ type: 'stream', conversationId, text: delta }));
        }
      }

      turnText = msgText;

      // Track each tool invocation by block ID
      for (const block of toolBlocks) {
        if (block.id && !sentToolIds.has(block.id)) {
          sentToolIds.add(block.id);
          const detail = extractToolDetail(block.name, block.input);
          toolsUsed.push({ tool: block.name, detail });
          ws.send(JSON.stringify({
            type: 'tool_use',
            conversationId,
            tool: block.name,
            detail,
          }));
        }
      }
    } else if (msg.type === 'result') {
      sessionId = msg.session_id || sessionId;
      conv.sessionId = sessionId;

      // Prefer the result text (clean final response without intermediate thinking)
      const finalText = msg.result || streamedText;

      conv.messages.push({
        role: 'assistant',
        content: finalText,
        timestamp: new Date().toISOString(),
        toolsUsed,
        costUsd: msg.total_cost_usd,
      });

      if (conv.messages.filter(m => m.role === 'user').length === 1) {
        conv.title = text.slice(0, 60) + (text.length > 60 ? '...' : '');
      }

      saveConversation(conv);

      ws.send(JSON.stringify({
        type: 'response_complete',
        conversationId,
        sessionId,
        costUsd: msg.total_cost_usd,
        finalText,
      }));
    }
  });

  proc.stderr.on('data', (data) => {
    console.error('[claude stderr]', data.toString());
  });

  proc.on('close', (code) => {
    activeProcesses.delete(conversationId);
    if (code !== 0 && ws.readyState === 1) {
      // Only send error if we haven't already sent a response_complete
      if (!streamedText) {
        ws.send(JSON.stringify({
          type: 'error',
          conversationId,
          message: `Claude process exited with code ${code}`,
        }));
      }
    }
  });

  proc.on('error', (err) => {
    activeProcesses.delete(conversationId);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'error',
        conversationId,
        message: err.message,
      }));
    }
  });
}

// --- WebSocket Handler ---

wss.on('connection', (ws) => {
  clients.add(ws);

  ws.on('close', () => clients.delete(ws));

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'chat':
        handleChat(ws, msg.conversationId, msg.text);
        break;

      case 'new_conversation': {
        const conv = createConversation();
        ws.send(JSON.stringify({ type: 'conversation', data: conv }));
        break;
      }

      case 'list_conversations':
        ws.send(JSON.stringify({ type: 'conversations', list: listConversations() }));
        break;

      case 'load_conversation': {
        const conv = loadConversation(msg.conversationId);
        if (conv) {
          ws.send(JSON.stringify({ type: 'conversation', data: conv }));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Conversation not found' }));
        }
        break;
      }

      case 'delete_conversation': {
        const file = path.join(CONV_DIR, `${msg.conversationId}.json`);
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          ws.send(JSON.stringify({ type: 'conversation_deleted', conversationId: msg.conversationId }));
        }
        break;
      }

      case 'file_tree':
        ws.send(JSON.stringify({ type: 'file_tree', tree: buildFileTree(getUserDir()) }));
        break;

      case 'read_file': {
        const userDir = getUserDir();
        const filePath = path.join(userDir, msg.path);
        if (!filePath.startsWith(userDir)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid path' }));
          break;
        }
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          ws.send(JSON.stringify({ type: 'file_content', path: msg.path, content }));
        } catch {
          ws.send(JSON.stringify({ type: 'error', message: `Cannot read ${msg.path}` }));
        }
        break;
      }

      case 'upload': {
        try {
          const buf = Buffer.from(msg.data, 'base64');
          const dest = path.join(getInboxRaw(), msg.filename);
          fs.writeFileSync(dest, buf);
          broadcastInbox();
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: `Upload failed: ${err.message}` }));
        }
        break;
      }

      case 'abort': {
        const proc = activeProcesses.get(msg.conversationId);
        if (proc) proc.kill('SIGTERM');
        break;
      }

      case 'list_profiles':
        ws.send(JSON.stringify({
          type: 'profiles',
          profiles: listProfiles(),
          active: getActiveProfile(),
        }));
        break;

      case 'create_profile': {
        try {
          const name = createProfile(msg.name);
          selectProfile(name);
          setupFileWatcher();
          ws.send(JSON.stringify({
            type: 'profile_selected',
            name,
            profiles: listProfiles(),
          }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
        break;
      }

      case 'select_profile': {
        try {
          selectProfile(msg.name);
          setupFileWatcher();
          ws.send(JSON.stringify({
            type: 'profile_selected',
            name: msg.name,
            profiles: listProfiles(),
          }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
        break;
      }

      case 'delete_profile': {
        try {
          deleteProfile(msg.name);
          setupFileWatcher();
          ws.send(JSON.stringify({
            type: 'profile_deleted',
            profiles: listProfiles(),
            active: getActiveProfile(),
          }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
        break;
      }

      case 'check_onboarding':
        ws.send(JSON.stringify({
          type: 'onboarding_status',
          required: !isOnboardingComplete(),
        }));
        break;

      case 'skip_onboarding':
        markOnboardingComplete();
        ws.send(JSON.stringify({ type: 'onboarding_complete' }));
        break;

      case 'upload_chatgpt_export': {
        try {
          const buf = Buffer.from(msg.data, 'base64');

          // Save raw zip
          const importDir = getImportDir();
          fs.mkdirSync(importDir, { recursive: true });
          fs.writeFileSync(path.join(importDir, 'export.zip'), buf);

          // Extract all readable files
          const files = extractExportFiles(buf);
          const totalSize = files.reduce((sum, f) => sum + f.size, 0);

          // Quick scan for conversation titles (if conversations.json exists)
          let convTitles = [];
          const convFile = files.find(f => f.name.endsWith('conversations.json'));
          if (convFile) {
            try {
              const raw = JSON.parse(convFile.content);
              if (Array.isArray(raw)) {
                convTitles = raw
                  .filter(c => c.title)
                  .map(c => c.title)
                  .slice(0, 50); // preview first 50
              }
            } catch {}
          }

          ws.send(JSON.stringify({
            type: 'import_parsed',
            totalFiles: files.length,
            fileNames: files.map(f => f.name),
            totalSize,
            convTitles,
            totalConversations: convTitles.length || null,
          }));

          // Hand it all to Claude
          processExportImport(ws, files);
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'import_error',
            message: `Failed to parse export: ${err.message}`,
          }));
        }
        break;
      }
    }
  });
});

// --- Start ---

const PORT = process.env.PORT || 3141;
server.listen(PORT, () => {
  console.log(`ClaudeGPT Web UI running at http://localhost:${PORT}`);
});
