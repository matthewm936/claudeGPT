/**
 * Audio processing for collections.
 * Prefers whisper-cpp (Metal-accelerated on Apple Silicon) with fallback to Python whisper.
 */

import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';

const CONCURRENCY = 4;

// --- Backend detection (cached) ---

let _backend = null;

function detectBackend() {
  if (_backend) return _backend;

  // Try whisper-cpp first (5-10x faster on Apple Silicon via Metal)
  // Brew installs it as whisper-cli (1.8+) or whisper-cpp (older)
  for (const bin of ['whisper-cli', 'whisper-cpp']) {
    try {
      execSync(`which ${bin}`, { stdio: 'pipe' });
      const modelPath = findWhisperCppModel();
      if (modelPath) {
        _backend = { type: 'whisper-cpp', bin, modelPath };
        console.log(`[audio] Using ${bin} with model: ${modelPath}`);
        return _backend;
      }
    } catch {}
  }

  // Fall back to Python whisper (pip install openai-whisper)
  try {
    const whisperPath = execSync('which whisper', { stdio: 'pipe' }).toString().trim();
    // Make sure it's Python whisper, not whisper-cpp's `whisper` shim
    const isScript = fs.readFileSync(whisperPath, 'utf-8').slice(0, 100).includes('python');
    if (isScript) {
      _backend = { type: 'python-whisper' };
      console.log('[audio] Using Python whisper (install whisper-cpp for 5-10x speedup)');
      return _backend;
    }
  } catch {}

  throw new Error('No whisper backend found. Install whisper-cpp (brew install whisper-cpp) or Python whisper.');
}

function findWhisperCppModel() {
  const candidates = [
    '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin',
    '/opt/homebrew/share/whisper-cpp/models/ggml-base.bin',
    '/usr/local/share/whisper-cpp/models/ggml-base.en.bin',
    '/usr/local/share/whisper-cpp/models/ggml-base.bin',
    path.join(process.env.HOME || '', '.whisper-cpp/models/ggml-base.en.bin'),
    path.join(process.env.HOME || '', '.whisper-cpp/models/ggml-base.bin'),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

// --- Convert non-WAV to WAV for whisper-cpp ---

function convertToWav(filePath, signal) {
  if (/\.wav$/i.test(filePath)) return Promise.resolve(filePath);

  const wavPath = filePath.replace(/\.[^.]+$/, '.wav');
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-i', filePath, '-ar', '16000', '-ac', '1', '-y', wavPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (signal) signal.addEventListener('abort', () => proc.kill('SIGTERM'), { once: true });
    proc.on('close', (code) => code === 0 ? resolve(wavPath) : reject(new Error(`ffmpeg failed (code ${code})`)));
    proc.on('error', reject);
  });
}

// --- Transcription ---

function runWhisperCpp(filePath, modelPath, signal) {
  return new Promise(async (resolve, reject) => {
    let wavPath;
    try {
      wavPath = await convertToWav(filePath, signal);
    } catch (err) {
      return reject(new Error(`Audio conversion failed: ${err.message}`));
    }

    const outBase = wavPath.replace(/\.wav$/, '');
    const backend = detectBackend();
    const proc = spawn(backend.bin, ['-m', modelPath, '-f', wavPath, '-otxt', '-of', outBase], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    if (signal) signal.addEventListener('abort', () => proc.kill('SIGTERM'), { once: true });

    proc.on('close', (code) => {
      // Clean up temp wav if we created one
      if (wavPath !== filePath && fs.existsSync(wavPath)) fs.unlinkSync(wavPath);

      if (code !== 0) return reject(new Error(`whisper-cpp failed (code ${code}): ${stderr.slice(-200)}`));

      const txtPath = outBase + '.txt';
      if (fs.existsSync(txtPath)) {
        const text = fs.readFileSync(txtPath, 'utf-8');
        fs.unlinkSync(txtPath);
        resolve(text);
      } else {
        resolve('(no transcript generated)');
      }
    });

    proc.on('error', reject);
  });
}

function runPythonWhisper(filePath, signal) {
  return new Promise((resolve, reject) => {
    const proc = spawn('whisper', [filePath, '--model', 'base.en', '--output_format', 'txt'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    if (signal) signal.addEventListener('abort', () => proc.kill('SIGTERM'), { once: true });

    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Whisper failed (code ${code}): ${stderr.slice(-200)}`));

      const txtPath = filePath.replace(/\.[^.]+$/, '.txt');
      if (fs.existsSync(txtPath)) {
        const text = fs.readFileSync(txtPath, 'utf-8');
        fs.unlinkSync(txtPath);
        resolve(text);
      } else {
        resolve(stdout || '(no transcript generated)');
      }
    });

    proc.on('error', reject);
  });
}

function transcribeFile(filePath, signal) {
  const backend = detectBackend();
  if (backend.type === 'whisper-cpp') return runWhisperCpp(filePath, backend.modelPath, signal);
  return runPythonWhisper(filePath, signal);
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
      const text = await transcribeFile(filePath, signal);

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
