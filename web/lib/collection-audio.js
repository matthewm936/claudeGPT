/**
 * Audio processing for collections via Whisper CLI.
 * Transcribes audio files and writes markdown transcripts.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const CONCURRENCY = 2;

/**
 * Run Whisper on a single audio file. Returns transcript text.
 */
function runWhisper(filePath, signal) {
  return new Promise((resolve, reject) => {
    const proc = spawn('whisper', [filePath, '--model', 'base', '--output_format', 'txt'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    if (signal) signal.addEventListener('abort', () => proc.kill('SIGTERM'), { once: true });

    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`Whisper failed (code ${code}): ${stderr.slice(-200)}`));
      else {
        // Whisper writes a .txt file next to the input — read it
        const txtPath = filePath.replace(/\.[^.]+$/, '.txt');
        if (fs.existsSync(txtPath)) {
          const text = fs.readFileSync(txtPath, 'utf-8');
          fs.unlinkSync(txtPath); // clean up whisper output
          resolve(text);
        } else {
          resolve(stdout || '(no transcript generated)');
        }
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Transcribe all audio files in a batch.
 */
export async function transcribeAudio(manifest, batchDir, callbacks, signal) {
  const originalsDir = path.join(batchDir, 'originals');
  const transcriptsDir = path.join(batchDir, 'transcripts');
  fs.mkdirSync(transcriptsDir, { recursive: true });

  const audioFiles = fs.readdirSync(originalsDir)
    .filter(f => /\.(m4a|mp3|wav|ogg|flac|aac|wma)$/i.test(f))
    .sort();

  if (audioFiles.length === 0) throw new Error('No audio files found');

  let processed = manifest.checkpoint?.lastProcessedFile || 0;
  const toProcess = audioFiles.slice(processed);

  // Process with limited concurrency
  const pending = toProcess.map((f, i) => ({ filename: f, index: processed + i }));
  const active = new Set();

  async function processOne() {
    if (pending.length === 0 || signal?.aborted) return;
    const { filename, index } = pending.shift();

    const filePath = path.join(originalsDir, filename);
    const slug = filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);

    try {
      const text = await runWhisper(filePath, signal);

      const frontMatter = [
        '---',
        `source_file: ${filename}`,
        `date: ${dateMatch ? dateMatch[1] : ''}`,
        `date_source: ${dateMatch ? 'filename' : 'none'}`,
        '---',
      ].join('\n');

      fs.writeFileSync(path.join(transcriptsDir, `${slug}.md`), `${frontMatter}\n\n${text}`);
    } catch (err) {
      if (callbacks?.onError) callbacks.onError(`Failed to transcribe ${filename}: ${err.message}`);
    }

    processed = index + 1;
    manifest.checkpoint.lastProcessedFile = processed;

    if (callbacks?.onFileProcessed) {
      callbacks.onFileProcessed({ filename, index, total: audioFiles.length });
    }

    const next = processOne();
    active.delete(active.values().next().value);
    return next;
  }

  const wave = Math.min(CONCURRENCY, pending.length);
  for (let i = 0; i < wave; i++) {
    const p = processOne();
    active.add(p);
  }

  while (active.size > 0) await Promise.race([...active]);

  return { totalFiles: audioFiles.length, processedCount: processed };
}
