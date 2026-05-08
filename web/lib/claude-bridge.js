import { spawn } from 'child_process';
import path from 'path';
import readline from 'readline';
import * as conversations from './conversations.js';
import { humanizeToolName, extractToolDetail } from './tool-humanize.js';

// Active runs: conversationId → { proc, ws, buffer, streamedText, toolsUsed, sentToolIds, sessionId, turnText, turnHasTools, conv, text, cwd }
const activeRuns = new Map();

export function abort(conversationId) {
  const run = activeRuns.get(conversationId);
  if (run) run.proc.kill('SIGTERM');
}

export function isActive(conversationId) {
  return activeRuns.has(conversationId);
}

export function listActive() {
  return [...activeRuns.keys()];
}

export function rejoin(ws, conversationId) {
  const run = activeRuns.get(conversationId);
  if (!run) return false;
  run.ws = ws;
  // Replay buffered output
  for (const msg of run.buffer) {
    ws.send(JSON.stringify(msg));
  }
  return true;
}

function trySend(run, msg) {
  run.buffer.push(msg);
  if (run.ws?.readyState === 1) run.ws.send(JSON.stringify(msg));
}

export async function handleChat(ws, conversationId, text, repoDir, profileDir) {
  let conv = conversations.load(conversationId);
  if (!conv) {
    conv = conversations.create();
    conv.id = conversationId;
    conversations.save(conv);
  }

  conv.messages.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
  conversations.save(conv);

  const args = ['-p', '--verbose', '--output-format', 'stream-json', '--permission-mode', 'acceptEdits', '--settings', '{"autoMemoryEnabled": false}'];
  if (conv.sessionId) args.push('--resume', conv.sessionId);
  args.push(text);

  const cwd = profileDir || repoDir;
  const proc = spawn('claude', args, {
    cwd,
    env: { ...process.env, PATH: `${path.join(repoDir, 'search')}:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const run = {
    proc, ws, buffer: [],
    streamedText: '', toolsUsed: [], sentToolIds: new Set(),
    sessionId: conv.sessionId, turnText: '', turnHasTools: false,
    conv, text, cwd,
  };
  activeRuns.set(conversationId, run);

  const rl = readline.createInterface({ input: proc.stdout });

  rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }

    if (msg.type === 'system' && msg.subtype === 'init') {
      run.sessionId = msg.session_id;
    } else if (msg.type === 'assistant') {
      const content = msg.message?.content || [];
      const textBlocks = content.filter(b => b.type === 'text');
      const toolBlocks = content.filter(b => b.type === 'tool_use');
      const msgText = textBlocks.map(b => b.text || '').join('');

      if (msgText.length < run.turnText.length) { run.turnText = ''; run.turnHasTools = false; }

      if (toolBlocks.length > 0 && !run.turnHasTools) {
        run.turnHasTools = true;
        if (run.turnText.length > 0) {
          run.streamedText = run.streamedText.slice(0, run.streamedText.length - run.turnText.length);
          trySend(run, { type: 'stream_reset', conversationId, text: run.streamedText });
        }
      }

      if (!run.turnHasTools) {
        const delta = msgText.slice(run.turnText.length);
        if (delta) { run.streamedText += delta; trySend(run, { type: 'stream', conversationId, text: delta }); }
      }

      run.turnText = msgText;

      for (const block of toolBlocks) {
        if (block.id && !run.sentToolIds.has(block.id)) {
          run.sentToolIds.add(block.id);
          const detail = extractToolDetail(block.name, block.input, cwd);
          const label = humanizeToolName(block.name, block.input);
          run.toolsUsed.push({ tool: label, detail });
          trySend(run, { type: 'tool_use', conversationId, tool: label, detail });
        }
      }
    } else if (msg.type === 'result') {
      run.sessionId = msg.session_id || run.sessionId;
      conv.sessionId = run.sessionId;
      const finalText = msg.result || run.streamedText;

      conv.messages.push({ role: 'assistant', content: finalText, timestamp: new Date().toISOString(), toolsUsed: run.toolsUsed, costUsd: msg.total_cost_usd });
      if (conv.messages.filter(m => m.role === 'user').length === 1) {
        conv.title = text.slice(0, 60) + (text.length > 60 ? '...' : '');
      }
      conversations.save(conv);
      trySend(run, { type: 'response_complete', conversationId, sessionId: run.sessionId, costUsd: msg.total_cost_usd, finalText });
    }
  });

  proc.stderr.on('data', (d) => console.error('[claude stderr]', d.toString()));

  proc.on('close', (code) => {
    activeRuns.delete(conversationId);
    if (code !== 0 && run.ws?.readyState === 1 && !run.streamedText) {
      run.ws.send(JSON.stringify({ type: 'error', conversationId, message: `Claude process exited with code ${code}` }));
    }
  });

  proc.on('error', (err) => {
    activeRuns.delete(conversationId);
    if (run.ws?.readyState === 1) run.ws.send(JSON.stringify({ type: 'error', conversationId, message: err.message }));
  });
}
