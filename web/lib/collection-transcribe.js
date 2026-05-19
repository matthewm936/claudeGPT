/**
 * Image transcription pipeline for collections.
 * Processes images in parallel batches using Claude CLI.
 */

import fs from 'fs';
import path from 'path';
import { spawnClaudeWorker } from './import-worker-pool.js';
import { buildImageTranscriptionPrompt } from './collection-prompts.js';

const BATCH_SIZE = 8;
const CONCURRENCY = 4;

/**
 * Parse a completed transcript to extract date info.
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
 * Scan KB for known names and terms to help disambiguate handwriting.
 */
export function gatherKnownTerms(profileDir) {
  const terms = [];
  if (!profileDir) return terms;

  const peopleDir = path.join(profileDir, 'world', 'people');
  if (fs.existsSync(peopleDir)) {
    for (const file of fs.readdirSync(peopleDir)) {
      if (file.endsWith('.md')) {
        const name = file.replace('.md', '').replace(/-/g, ' ');
        terms.push(name.charAt(0).toUpperCase() + name.slice(1));
      }
    }
  }

  const projectsDir = path.join(profileDir, 'world', 'projects');
  if (fs.existsSync(projectsDir)) {
    for (const file of fs.readdirSync(projectsDir)) {
      if (file.endsWith('.md')) {
        terms.push(file.replace('.md', '').replace(/-/g, ' '));
      }
    }
  }

  return terms;
}

/**
 * Transcribe all images in a batch using parallel Claude workers.
 */
export async function transcribeImages(manifest, batchDir, profileDir, callbacks, signal) {
  const originalsDir = path.join(batchDir, 'originals');
  const transcriptsDir = path.join(batchDir, 'transcripts');
  fs.mkdirSync(transcriptsDir, { recursive: true });

  const imageFiles = fs.readdirSync(originalsDir)
    .filter(f => /\.(jpg|jpeg|png|heic|webp|tiff|bmp)$/i.test(f))
    .sort();

  if (imageFiles.length === 0) throw new Error('No image files found');

  const knownTerms = gatherKnownTerms(profileDir);
  const startPage = (manifest.checkpoint?.lastProcessedFile || 0) + 1;

  const allPages = imageFiles.map((file, i) => ({
    number: i + 1,
    imagePath: `originals/${file}`,
    filename: file,
  }));

  const pagesToProcess = allPages.filter(p => p.number >= startPage);
  const batches = [];
  for (let i = 0; i < pagesToProcess.length; i += BATCH_SIZE) {
    batches.push(pagesToProcess.slice(i, i + BATCH_SIZE));
  }

  let transcribedCount = startPage - 1;

  async function runBatch(batch, batchIdx) {
    const prompt = buildImageTranscriptionPrompt(batch, manifest, '', knownTerms);

    try {
      await spawnClaudeWorker(prompt, batchDir, {
        allowedTools: ['Write', 'Read', 'Glob'],
        maxTurns: batch.length * 3 + 5,
        permissionMode: 'bypassPermissions',
        model: 'opus',
        onFileCreated: (info) => {
          const pageMatch = info.filePath.match(/page-(\d+)/);
          if (pageMatch) {
            const pageNum = parseInt(pageMatch[1], 10);
            transcribedCount = Math.max(transcribedCount, pageNum);
            const result = parseTranscriptResult(transcriptsDir, pageNum);
            if (result) callbacks?.onPageTranscribed?.({ ...result, totalPages: imageFiles.length });
            if (result?.hasDate && result.date) callbacks?.onAnchorDateFound?.({ page: pageNum, date: result.date });
          }
        },
        onToolActivity: callbacks?.onToolActivity,
        signal,
      });
    } catch (err) {
      callbacks?.onError?.(`Batch ${batchIdx + 1} failed: ${err.message}`);
    }

    callbacks?.onBatchComplete?.({ batchIndex: batchIdx, totalBatches: batches.length, pagesTranscribed: transcribedCount });
  }

  // Concurrent pool
  const pending = batches.map((batch, i) => ({ batch, index: i }));
  const active = new Set();

  function runNext() {
    if (pending.length === 0 || signal?.aborted) return Promise.resolve();
    const { batch, index } = pending.shift();
    const promise = runBatch(batch, index).then(() => { active.delete(promise); return runNext(); });
    active.add(promise);
    return promise;
  }

  const wave = Math.min(CONCURRENCY, batches.length);
  for (let i = 0; i < wave; i++) runNext();
  while (active.size > 0) await Promise.race([...active]);

  return { totalPages: imageFiles.length, transcribedCount };
}
