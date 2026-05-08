/**
 * Haiku batch summarization — fast, cheap triage of conversations.
 * Spawns the claude CLI with --print and Haiku model for each batch.
 */

import { spawn } from 'child_process';
import { buildSummaryPrompt, parseSummaryResponse } from './import-prompts.js';

const BATCH_SIZE = 30; // conversations per Haiku call
const MAX_CONCURRENCY = 5; // parallel claude CLI calls

/**
 * Run a single claude CLI call for one batch — prompt piped via stdin, text out.
 */
function runClaudeHaiku(prompt, signal) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--model', 'claude-haiku-4-5-20251001',
      '--output-format', 'text',
      '--system-prompt', 'You are a conversation classifier. Respond only with the requested format. No preamble.',
      '--max-turns', '1',
    ];

    const proc = spawn('claude', args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Pipe prompt via stdin to avoid ARG_MAX limits
    proc.stdin.write(prompt);
    proc.stdin.end();

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    if (signal) {
      signal.addEventListener('abort', () => proc.kill('SIGTERM'), { once: true });
    }

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`[haiku] exited ${code}, stderr: ${stderr.slice(0, 500)}`);
        reject(new Error(stderr.slice(0, 300) || `claude exited with code ${code}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Summarize all conversations using Haiku in parallel batches.
 * Streams results via callback as each batch completes.
 *
 * @param {Array} triageQueue - from prepareForSummary()
 * @param {Object} callbacks
 * @param {Function} callbacks.onBatchStart - called with array of {id, title} when batch starts processing
 * @param {Function} callbacks.onBatchComplete - called with array of {id, title, date, category, summary, decision, reason}
 * @param {Function} callbacks.onProgress - called with {summarized, total}
 * @param {Function} callbacks.onError - called with error message string
 * @param {AbortSignal} callbacks.signal - optional abort signal
 * @returns {Promise<Array>} all summary results
 */
export async function summarizeAll(triageQueue, { onBatchStart, onBatchComplete, onProgress, onError, signal } = {}) {
  const allResults = [];
  let summarized = 0;
  let failedBatches = 0;

  // Split into batches
  const batches = [];
  for (let i = 0; i < triageQueue.length; i += BATCH_SIZE) {
    batches.push(triageQueue.slice(i, i + BATCH_SIZE));
  }

  console.log(`[triage] ${triageQueue.length} conversations → ${batches.length} batches of ~${BATCH_SIZE}`);

  // Process batches with concurrency limit
  const pending = [...batches.entries()];
  const active = new Set();

  async function processBatch(batchIndex, batch) {
    if (signal?.aborted) return;

    // Notify which conversations are being read
    if (onBatchStart) {
      onBatchStart(batch.map(c => ({ id: c.id, title: c.title, date: c.date })));
    }

    const prompt = buildSummaryPrompt(batch);
    console.log(`[triage] batch ${batchIndex + 1}/${batches.length}: sending ${batch.length} conversations (${(prompt.length / 1024).toFixed(1)}KB prompt)`);

    const text = await runClaudeHaiku(prompt, signal);
    console.log(`[triage] batch ${batchIndex + 1}/${batches.length}: got response (${text.length} chars)`);

    const results = parseSummaryResponse(text, batch);
    console.log(`[triage] batch ${batchIndex + 1}/${batches.length}: parsed ${results.length}/${batch.length} items (${results.filter(r => r.decision === 'keep').length} keep, ${results.filter(r => r.decision === 'skip').length} skip, ${results.filter(r => r.decision === 'ask').length} ask)`);

    if (results.length === 0 && batch.length > 0) {
      console.error(`[triage] batch ${batchIndex + 1}: PARSE FAILED — raw response:\n${text.slice(0, 1000)}`);
    }

    allResults.push(...results);
    summarized += batch.length;

    if (onBatchComplete) onBatchComplete(results);
    if (onProgress) onProgress({ summarized, total: triageQueue.length });
  }

  // Run with concurrency limit
  async function runNext() {
    if (pending.length === 0 || signal?.aborted) return;
    const [batchIndex, batch] = pending.shift();
    const promise = processBatch(batchIndex, batch)
      .catch(err => {
        failedBatches++;
        console.error(`[triage] batch ${batchIndex + 1} failed:`, err.message);
        if (onError) onError(`Batch ${batchIndex + 1} failed: ${err.message}`);
        summarized += batch.length;
        if (onProgress) onProgress({ summarized, total: triageQueue.length });
      })
      .finally(() => {
        active.delete(promise);
        return runNext();
      });
    active.add(promise);
  }

  // Start initial wave
  const initialWave = Math.min(MAX_CONCURRENCY, batches.length);
  const starters = [];
  for (let i = 0; i < initialWave; i++) {
    starters.push(runNext());
  }
  await Promise.all(starters);

  // Wait for all active to finish
  while (active.size > 0) {
    await Promise.race([...active]);
  }

  console.log(`[triage] done: ${allResults.length} items classified, ${failedBatches} batches failed`);

  if (failedBatches === batches.length) {
    throw new Error('All summarization batches failed — check Claude Code auth');
  }

  return allResults;
}
