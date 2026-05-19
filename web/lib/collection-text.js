/**
 * Text file processing for collections.
 * Reads plain text directly; copies PDFs as-is for Claude to read during assembly.
 */

import fs from 'fs';
import path from 'path';

const PLAIN_TEXT_EXTS = /\.(txt|md|rtf|csv|json)$/i;
const PDF_EXT = /\.pdf$/i;

/**
 * Process text files in a batch — read each and write a normalized transcript.
 * PDFs get copied to transcripts/ as-is — Claude reads them during assembly.
 */
export async function processTextFiles(manifest, batchDir, callbacks, signal) {
  const originalsDir = path.join(batchDir, 'originals');
  const transcriptsDir = path.join(batchDir, 'transcripts');
  fs.mkdirSync(transcriptsDir, { recursive: true });

  const textFiles = fs.readdirSync(originalsDir)
    .filter(f => PLAIN_TEXT_EXTS.test(f) || PDF_EXT.test(f))
    .sort();

  if (textFiles.length === 0) throw new Error('No text files found');

  let processed = manifest.checkpoint?.lastProcessedFile || 0;

  for (let i = processed; i < textFiles.length; i++) {
    if (signal?.aborted) break;

    const filename = textFiles[i];
    const filePath = path.join(originalsDir, filename);
    const isPdf = PDF_EXT.test(filename);
    const slug = filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

    if (isPdf) {
      // Copy PDF to transcripts/ — Claude reads it during assembly
      fs.copyFileSync(filePath, path.join(transcriptsDir, filename));
    } else {
      const content = fs.readFileSync(filePath, 'utf-8');
      const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
      const frontMatter = [
        '---',
        `source_file: ${filename}`,
        `date: ${dateMatch ? dateMatch[1] : ''}`,
        `date_source: ${dateMatch ? 'filename' : 'none'}`,
        '---',
      ].join('\n');
      fs.writeFileSync(path.join(transcriptsDir, `${slug}.md`), `${frontMatter}\n\n${content}`);
    }

    processed = i + 1;
    manifest.checkpoint.lastProcessedFile = processed;

    if (callbacks?.onFileProcessed) {
      const snippet = isPdf ? `[PDF: ${filename}]` : fs.readFileSync(filePath, 'utf-8').slice(0, 120);
      callbacks.onFileProcessed({ filename, snippet, index: i, total: textFiles.length });
    }
  }

  return { totalFiles: textFiles.length, processedCount: processed };
}
