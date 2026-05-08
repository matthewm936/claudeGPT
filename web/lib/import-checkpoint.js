/**
 * Checkpoint persistence for the import pipeline.
 * Saves triage results and decisions to disk so the pipeline
 * can resume after crashes, accidental cancellation, or page refresh.
 */

import fs from 'fs';
import path from 'path';

function getPath(importDir) {
  return path.join(importDir, 'checkpoint.json');
}

export function save(importDir, phase, data) {
  fs.mkdirSync(importDir, { recursive: true });
  const checkpoint = {
    phase,
    savedAt: new Date().toISOString(),
    ...data,
  };
  fs.writeFileSync(getPath(importDir), JSON.stringify(checkpoint, null, 2));
}

export function load(importDir) {
  const p = getPath(importDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function clear(importDir) {
  const p = getPath(importDir);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function exists(importDir) {
  return fs.existsSync(getPath(importDir));
}
