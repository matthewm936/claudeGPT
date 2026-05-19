/**
 * File type detection and grouping for collections.
 * Routes files to the correct processing pipeline.
 */

const IMAGE_EXTS = /\.(jpg|jpeg|png|heic|webp|tiff|bmp)$/i;
const AUDIO_EXTS = /\.(m4a|mp3|wav|ogg|flac|aac|wma)$/i;
const TEXT_EXTS = /\.(txt|md|rtf|csv|json|pdf)$/i;

export function detectFileType(filename) {
  if (IMAGE_EXTS.test(filename)) return 'image';
  if (AUDIO_EXTS.test(filename)) return 'audio';
  if (TEXT_EXTS.test(filename)) return 'text';
  return 'unknown';
}

export function detectBatchType(filenames) {
  const types = filenames.map(detectFileType);
  const unique = new Set(types.filter(t => t !== 'unknown'));
  if (unique.size === 0) return 'unknown';
  if (unique.size === 1) return [...unique][0];
  return 'mixed';
}

export function groupFilesByType(filenames) {
  const groups = { images: [], audio: [], text: [], unknown: [] };
  for (const f of filenames) {
    const type = detectFileType(f);
    if (type === 'image') groups.images.push(f);
    else if (type === 'audio') groups.audio.push(f);
    else if (type === 'text') groups.text.push(f);
    else groups.unknown.push(f);
  }
  return groups;
}
