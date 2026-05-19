/**
 * Synthesis worker for collections.
 * Reads collection content and updates KB synthesis layers.
 * Content stays in the collection — only understanding is extracted.
 */

import path from 'path';
import { spawnClaudeWorker } from './import-worker-pool.js';
import { buildSynthesisPrompt, buildContextUpdatePrompt } from './collection-prompts.js';
import { loadManifest } from './collection-manifest.js';
import fs from 'fs';

/**
 * Run synthesis on a single batch — Claude reads content,
 * updates understanding/world/active/now.md, and generates context files.
 */
export async function synthesizeBatch(collectionManifest, batchManifest, profileDir, callbacks, signal) {
  const prompt = buildSynthesisPrompt(collectionManifest, batchManifest);

  return spawnClaudeWorker(prompt, profileDir, {
    allowedTools: ['Write', 'Edit', 'Read', 'Glob', 'Grep', 'Bash'],
    maxTurns: 50,
    permissionMode: 'bypassPermissions',
    onFileCreated: callbacks?.onFileCreated,
    onToolActivity: callbacks?.onToolActivity,
    signal,
  });
}

/**
 * Regenerate collection-level context.md after new batches are added.
 * Reads all batch contexts and produces a unified collection context.
 */
export async function updateCollectionContext(collectionDir, profileDir, callbacks, signal) {
  const collectionManifest = loadManifest(collectionDir);
  if (!collectionManifest) throw new Error('Collection manifest not found');

  const batchesDir = path.join(collectionDir, 'batches');
  if (!fs.existsSync(batchesDir)) return;

  const batchManifests = [];
  for (const slug of fs.readdirSync(batchesDir)) {
    const batchDir = path.join(batchesDir, slug);
    if (!fs.statSync(batchDir).isDirectory()) continue;
    const bm = loadManifest(batchDir);
    if (bm) batchManifests.push(bm);
  }

  if (batchManifests.length <= 1) return; // single batch context is already written by synthesis

  const prompt = buildContextUpdatePrompt(collectionManifest, batchManifests);

  return spawnClaudeWorker(prompt, profileDir, {
    allowedTools: ['Write', 'Edit', 'Read', 'Glob'],
    maxTurns: 20,
    permissionMode: 'bypassPermissions',
    onFileCreated: callbacks?.onFileCreated,
    onToolActivity: callbacks?.onToolActivity,
    signal,
  });
}
