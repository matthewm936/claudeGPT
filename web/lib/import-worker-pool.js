/**
 * Parallel ingestion workers using the Claude CLI.
 * Processes curated conversations into KB files.
 */

import { spawn } from 'child_process';
import readline from 'readline';
import { buildIngestionPrompt, buildSynthesisPrompt } from './import-prompts.js';
import { prepareForIngestion } from './parse-export.js';

const MAX_BATCH_SIZE = 400 * 1024; // 400KB per batch
const DEFAULT_CONCURRENCY = 3;

/**
 * Batch conversations by cumulative content size,
 * grouped by time window to minimize file conflicts.
 */
export function buildIngestionBatches(conversations, maxBatchSize = MAX_BATCH_SIZE) {
  const prepared = conversations.map(c => prepareForIngestion(c));

  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  for (const conv of prepared) {
    const size = conv.content.length;

    if (currentSize + size > maxBatchSize && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(conv);
    currentSize += size;
  }

  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

/**
 * Spawn a claude CLI process with stream-json output.
 * Returns a promise that resolves with { filesCreated, cost, success }.
 */
export function spawnClaudeWorker(prompt, cwd, { allowedTools, maxTurns, permissionMode, onFileCreated, onToolActivity, signal }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      '--permission-mode', permissionMode || 'bypassPermissions',
      '--max-turns', String(maxTurns || 50),
    ];

    if (allowedTools?.length) {
      args.push('--allowedTools', ...allowedTools);
    }

    const proc = spawn('claude', args, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Pipe prompt via stdin to avoid ARG_MAX limits
    proc.stdin.write(prompt);
    proc.stdin.end();

    const filesCreated = [];
    let cost = 0;
    let success = true;

    const rl = readline.createInterface({ input: proc.stdout });

    rl.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }

      if (msg.type === 'assistant' && msg.message?.content) {
        const toolBlocks = (msg.message.content || []).filter(b => b.type === 'tool_use');
        for (const block of toolBlocks) {
          if ((block.name === 'Write' || block.name === 'Edit') && block.input?.file_path) {
            // Normalize: strip cwd prefix to get relative path within profile
            let filePath = block.input.file_path.replace(cwd + '/', '');
            // Also strip any absolute path prefix
            if (filePath.startsWith('/')) filePath = filePath.replace(/^.*\/profiles\/[^/]+\//, '');
            filesCreated.push(filePath);
            if (onFileCreated) {
              onFileCreated({
                filePath,
                action: block.name === 'Write' ? 'created' : 'updated',
                snippet: (block.input.content || block.input.new_string || '').slice(0, 150),
              });
            }
          } else if (onToolActivity) {
            // Stream non-write tool activity so the user sees progress
            const detail = block.name === 'Read' ? block.input?.file_path?.replace(cwd + '/', '')
              : block.name === 'Glob' ? block.input?.pattern
              : block.name === 'Grep' ? block.input?.pattern
              : block.name === 'Bash' ? (block.input?.command || '').slice(0, 80)
              : null;
            if (detail) onToolActivity({ tool: block.name, detail });
          }
        }
      } else if (msg.type === 'result') {
        cost = msg.total_cost_usd || 0;
        success = !msg.is_error;
      }
    });

    if (signal) {
      signal.addEventListener('abort', () => proc.kill('SIGTERM'), { once: true });
    }

    let stderrBuf = '';
    proc.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderrBuf += chunk;
      if (stderrBuf.length > 2000) stderrBuf = stderrBuf.slice(-2000);
      console.error('[worker stderr]', chunk.slice(0, 300));
    });

    proc.on('close', (code) => {
      if (code !== 0 && filesCreated.length === 0) {
        reject(new Error(`claude exited with code ${code}: ${stderrBuf.slice(-500)}`));
      } else {
        resolve({ filesCreated, cost, success: code === 0 });
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Run a single ingestion worker — one claude CLI session processing one batch.
 */
async function runWorker(batch, batchIndex, totalBatches, cwd, { onFileCreated, onToolActivity }, signal) {
  const prompt = buildIngestionPrompt(batch, batchIndex, totalBatches);

  const result = await spawnClaudeWorker(prompt, cwd, {
    allowedTools: ['Write', 'Edit', 'Read', 'Glob', 'Grep', 'Bash'],
    maxTurns: 50,
    permissionMode: 'bypassPermissions',
    onFileCreated: onFileCreated ? (info) => onFileCreated({ ...info, worker: batchIndex }) : undefined,
    onToolActivity: onToolActivity ? (info) => onToolActivity({ ...info, worker: batchIndex }) : undefined,
    signal,
  });

  return {
    batchIndex,
    filesCreated: result.filesCreated,
    cost: result.cost,
    success: result.success,
  };
}

/**
 * Process all batches with concurrent workers.
 */
export async function processAllBatches(batches, cwd, callbacks = {}, signal, concurrency = DEFAULT_CONCURRENCY) {
  const { onFileCreated, onToolActivity, onBatchComplete, onProgress } = callbacks;
  let completedBatches = 0;
  let totalFilesCreated = 0;
  const results = [];

  const pending = batches.map((batch, i) => ({ batch, index: i }));
  const active = new Set();

  async function runNext() {
    if (pending.length === 0 || signal?.aborted) return;
    const { batch, index } = pending.shift();

    const promise = runWorker(batch, index, batches.length, cwd, { onFileCreated, onToolActivity }, signal)
      .catch(err => {
        console.error(`Ingestion worker ${index} failed:`, err.message);
        return { batchIndex: index, filesCreated: [], cost: 0, success: false, error: err.message };
      })
      .then(result => {
        results.push(result);
        completedBatches++;
        totalFilesCreated += result.filesCreated.length;

        if (onBatchComplete) onBatchComplete(result);
        if (onProgress) onProgress({ completedBatches, totalBatches: batches.length, totalFilesCreated });

        active.delete(promise);
        return runNext();
      });

    active.add(promise);
  }

  // Start initial wave
  const initialWave = Math.min(concurrency, batches.length);
  for (let i = 0; i < initialWave; i++) {
    await runNext();
  }

  // Wait for all active to finish
  while (active.size > 0) {
    await Promise.race([...active]);
  }

  return results;
}

/**
 * Run the final synthesis pass to merge duplicates and create summary files.
 */
export async function runSynthesis(totalBatches, cwd, signal) {
  const prompt = buildSynthesisPrompt(totalBatches);

  const result = await spawnClaudeWorker(prompt, cwd, {
    allowedTools: ['Write', 'Edit', 'Read', 'Glob', 'Grep', 'Bash'],
    maxTurns: 30,
    permissionMode: 'bypassPermissions',
    signal,
  });

  return result;
}
