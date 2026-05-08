/**
 * Page-by-page transcription pipeline using Claude CLI.
 * Processes handwritten journal pages in sequential batches.
 */

import fs from 'fs';
import path from 'path';
import { spawnClaudeWorker } from './import-worker-pool.js';
import { buildTranscriptionPrompt } from './artifact-prompts.js';

const BATCH_SIZE = 8;
const CONTEXT_OVERLAP = 2; // pages from previous batch for continuity

/**
 * Get the last N transcripts as context for the next batch.
 */
function getPreviousContext(transcriptsDir, lastPage, count) {
  const lines = [];
  const startPage = Math.max(1, lastPage - count + 1);

  for (let p = startPage; p <= lastPage; p++) {
    const file = path.join(transcriptsDir, `page-${String(p).padStart(3, '0')}.md`);
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf-8');
      // Strip front matter for context
      const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
      if (body) lines.push(`[Page ${p}]\n${body.slice(0, 500)}`);
    }
  }

  return lines.length > 0 ? lines.join('\n\n') : '';
}

/**
 * Parse a completed transcript file to extract date info.
 */
function parseTranscriptResult(transcriptsDir, pageNum) {
  const file = path.join(transcriptsDir, `page-${String(pageNum).padStart(3, '0')}.md`);
  if (!fs.existsSync(file)) return null;

  const content = fs.readFileSync(file, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const meta = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) meta[key.trim()] = rest.join(':').trim();
  }

  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();

  return {
    page: pageNum,
    hasDate: meta.has_date === 'true',
    date: meta.date || '',
    dateSource: meta.date_source || 'none',
    snippet: body.slice(0, 120),
  };
}

/**
 * Transcribe all pages of a journal in sequential batches.
 *
 * @param {Object} manifest - The journal manifest
 * @param {string} artifactDir - Path to the artifact directory (journals/{slug})
 * @param {Object} callbacks - { onPageTranscribed, onBatchComplete, onAnchorDateFound, onToolActivity, onError }
 * @param {AbortSignal} signal - Abort signal
 */
export async function transcribePages(manifest, artifactDir, callbacks, signal) {
  const originalsDir = path.join(artifactDir, 'originals');
  const transcriptsDir = path.join(artifactDir, 'transcripts');

  fs.mkdirSync(transcriptsDir, { recursive: true });

  // Find all page images
  const imageFiles = fs.readdirSync(originalsDir)
    .filter(f => /\.(jpg|jpeg|png|heic|webp)$/i.test(f))
    .sort();

  const totalPages = imageFiles.length;
  if (totalPages === 0) throw new Error('No page images found');

  // Determine starting page (for resume)
  const startPage = (manifest.checkpoint?.lastTranscribedPage || 0) + 1;

  // Build page list
  const allPages = imageFiles.map((file, i) => ({
    number: i + 1,
    imagePath: `originals/${file}`,
    filename: file,
  }));

  // Process in batches
  const pagesToProcess = allPages.filter(p => p.number >= startPage);
  const batches = [];
  for (let i = 0; i < pagesToProcess.length; i += BATCH_SIZE) {
    batches.push(pagesToProcess.slice(i, i + BATCH_SIZE));
  }

  let transcribedCount = startPage - 1;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    if (signal?.aborted) break;

    const batch = batches[batchIdx];
    const firstPageInBatch = batch[0].number;

    // Get context from previous batch
    const previousContext = firstPageInBatch > 1
      ? getPreviousContext(transcriptsDir, firstPageInBatch - 1, CONTEXT_OVERLAP)
      : '';

    const prompt = buildTranscriptionPrompt(batch, manifest, previousContext);

    try {
      await spawnClaudeWorker(prompt, artifactDir, {
        allowedTools: ['Write', 'Read', 'Glob'],
        maxTurns: batch.length * 3 + 5, // ~3 tool calls per page + overhead
        permissionMode: 'bypassPermissions',
        onFileCreated: (info) => {
          // Extract page number from filename
          const pageMatch = info.filePath.match(/page-(\d+)/);
          if (pageMatch) {
            const pageNum = parseInt(pageMatch[1], 10);
            transcribedCount = Math.max(transcribedCount, pageNum);

            const result = parseTranscriptResult(transcriptsDir, pageNum);
            if (result && callbacks?.onPageTranscribed) {
              callbacks.onPageTranscribed({ ...result, totalPages });
            }
            if (result?.hasDate && result.date && callbacks?.onAnchorDateFound) {
              callbacks.onAnchorDateFound({ page: pageNum, date: result.date });
            }
          }
        },
        onToolActivity: callbacks?.onToolActivity,
        signal,
      });
    } catch (err) {
      if (callbacks?.onError) callbacks.onError(`Batch ${batchIdx + 1} failed: ${err.message}`);
      // Continue with next batch — partial results are still useful
    }

    if (callbacks?.onBatchComplete) {
      callbacks.onBatchComplete({
        batchIndex: batchIdx,
        totalBatches: batches.length,
        pagesTranscribed: transcribedCount,
      });
    }
  }

  return { totalPages, transcribedCount };
}
