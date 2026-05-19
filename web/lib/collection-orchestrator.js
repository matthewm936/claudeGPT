/**
 * Central coordinator for the collections pipeline.
 * Manages creation, upload, processing, and querying of collections and batches.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import * as profiles from './profiles.js';
import * as manifests from './collection-manifest.js';
import { detectBatchType, groupFilesByType } from './collection-detect.js';
import { transcribeImages } from './collection-transcribe.js';
import { transcribeAudio } from './collection-audio.js';
import { processTextFiles } from './collection-text.js';
import { synthesizeBatch, updateCollectionContext } from './collection-synthesis.js';
import { interpolateDates } from './collection-dates.js';
import { buildAssemblyPrompt } from './collection-prompts.js';
import { spawnClaudeWorker } from './import-worker-pool.js';

let activeSession = null;

export function getSession() { return activeSession; }
export function clearSession() { activeSession = null; }

function extractZipFiles(originalsDir) {
  const zips = fs.readdirSync(originalsDir).filter(f => /\.zip$/i.test(f));
  for (const zip of zips) {
    const zipPath = path.join(originalsDir, zip);
    try {
      execSync(`unzip -o -j "${zipPath}" -d "${originalsDir}" -x "__MACOSX/*" "*.DS_Store"`, { stdio: 'pipe' });
      fs.unlinkSync(zipPath);
    } catch (err) {
      console.error(`[zip] Failed to extract ${zip}: ${err.message}`);
    }
  }
}

// --- Collection CRUD ---

export function createCollection(ws, metadata, profilesDir) {
  const slug = manifests.slugify(metadata.name);
  const dir = path.join(manifests.collectionsDir(profilesDir), slug);
  fs.mkdirSync(path.join(dir, 'batches'), { recursive: true });

  const manifest = manifests.createCollectionManifest(metadata.name, metadata.description);
  manifests.saveManifest(dir, manifest);

  ws.send(JSON.stringify({ type: 'collection_created', collectionId: manifest.id, slug }));
  return { id: manifest.id, slug, dir };
}

export function addBatch(ws, collectionId, batchMetadata, profilesDir) {
  const coll = manifests.findCollection(collectionId, profilesDir);
  if (!coll) throw new Error('Collection not found');

  const batchSlug = manifests.slugify(batchMetadata.name);
  const batchDir = path.join(coll.dir, 'batches', batchSlug);
  fs.mkdirSync(path.join(batchDir, 'originals'), { recursive: true });
  fs.mkdirSync(path.join(batchDir, 'transcripts'), { recursive: true });

  const batchManifest = manifests.createBatchManifest(batchMetadata.name, batchMetadata);
  manifests.saveManifest(batchDir, batchManifest);

  // Update collection manifest
  coll.manifest.batches.push({ slug: batchSlug, name: batchMetadata.name, status: 'uploading', fileCount: 0 });
  manifests.saveManifest(coll.dir, coll.manifest);

  ws.send(JSON.stringify({ type: 'batch_created', collectionId, batchSlug, batchId: batchManifest.id }));
  return { id: batchManifest.id, slug: batchSlug, dir: batchDir };
}

// --- Upload ---

export function handleUploadStart(ws, collectionId, batchSlug, profilesDir) {
  const coll = manifests.findCollection(collectionId, profilesDir);
  if (!coll) throw new Error('Collection not found');

  const batchDir = path.join(coll.dir, 'batches', batchSlug);
  const batchManifest = manifests.loadManifest(batchDir);
  if (!batchManifest) throw new Error('Batch not found');

  activeSession = {
    collectionId, batchSlug, collectionDir: coll.dir, batchDir,
    collectionManifest: coll.manifest, batchManifest,
    abortController: new AbortController(),
  };

  ws.send(JSON.stringify({ type: 'batch_upload_started', collectionId, batchSlug }));
}

export function handleUploadFile(ws, collectionId, batchSlug, fileIndex, filename, fileData, profilesDir) {
  if (!activeSession || activeSession.collectionId !== collectionId) {
    ws.send(JSON.stringify({ type: 'collection_error', message: 'No active upload session' }));
    return;
  }

  const ext = path.extname(filename).toLowerCase() || '.bin';
  const paddedIdx = String(fileIndex).padStart(3, '0');
  // Keep original name for non-image files, use page numbering for images
  const isImage = /\.(jpg|jpeg|png|heic|webp|tiff|bmp)$/i.test(filename);
  const destName = isImage ? `page-${paddedIdx}${ext}` : filename;
  const dest = path.join(activeSession.batchDir, 'originals', destName);

  fs.writeFileSync(dest, Buffer.from(fileData, 'base64'));
  ws.send(JSON.stringify({ type: 'batch_file_received', fileIndex }));
}

export async function handleUploadComplete(ws, collectionId, batchSlug, totalFiles, profilesDir) {
  if (!activeSession || activeSession.collectionId !== collectionId) {
    ws.send(JSON.stringify({ type: 'collection_error', message: 'No active upload session' }));
    return;
  }

  // Extract any zip archives first
  const originalsDir = path.join(activeSession.batchDir, 'originals');
  extractZipFiles(originalsDir);

  // Re-read after zip extraction (may have new files)
  const files = fs.readdirSync(originalsDir).filter(f => !f.startsWith('.'));
  const fileType = detectBatchType(files);

  activeSession.batchManifest.fileCount = files.length;
  activeSession.batchManifest.fileType = fileType;
  activeSession.batchManifest.phase = 'transcribing';
  activeSession.batchManifest.status = 'processing';
  manifests.saveManifest(activeSession.batchDir, activeSession.batchManifest);

  // Update collection batch entry
  const batchEntry = activeSession.collectionManifest.batches.find(b => b.slug === batchSlug);
  if (batchEntry) { batchEntry.fileCount = totalFiles; batchEntry.status = 'processing'; }
  activeSession.collectionManifest.status = 'processing';
  manifests.saveManifest(activeSession.collectionDir, activeSession.collectionManifest);

  ws.send(JSON.stringify({ type: 'batch_processing', collectionId, batchSlug, fileType, totalFiles }));

  await runBatchPipeline(ws, profilesDir);
}

// --- Processing Pipeline ---

async function runBatchPipeline(ws, profilesDir) {
  const session = activeSession;
  if (!session) return;

  const { batchDir, batchManifest, collectionManifest, collectionDir } = session;
  const profileDir = profiles.getDir(profilesDir);
  const signal = session.abortController.signal;
  const send = (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  try {
    // Phase 1: Transcription / Processing (based on file type)
    if (!batchManifest.checkpoint.assembled) {
      batchManifest.phase = 'transcribing';
      manifests.saveManifest(batchDir, batchManifest);
      send({ type: 'collection_progress', phase: 'transcribing', currentFile: 0, totalFiles: batchManifest.fileCount });

      const fileType = batchManifest.fileType;

      if (fileType === 'image') {
        await transcribeImages(batchManifest, batchDir, profileDir, {
          onPageTranscribed: (info) => { send({ type: 'collection_file_processed', ...info }); },
          onBatchComplete: (info) => { send({ type: 'collection_progress', phase: 'transcribing', currentFile: info.pagesTranscribed, totalFiles: batchManifest.fileCount }); },
          onAnchorDateFound: (info) => { batchManifest.anchorDates.push(info); manifests.saveManifest(batchDir, batchManifest); },
          onToolActivity: (info) => send({ type: 'collection_tool_activity', ...info }),
          onError: (msg) => send({ type: 'collection_error', message: msg }),
        }, signal);

        // Date interpolation (images only)
        const anchors = interpolateDates(batchManifest, batchDir);
        if (anchors.length > 0) batchManifest.anchorDates = anchors;
        manifests.saveManifest(batchDir, batchManifest);

      } else if (fileType === 'audio') {
        await transcribeAudio(batchManifest, batchDir, {
          onFileProcessed: (info) => send({ type: 'collection_file_processed', ...info }),
          onError: (msg) => send({ type: 'collection_error', message: msg }),
        }, signal);

      } else if (fileType === 'text') {
        await processTextFiles(batchManifest, batchDir, {
          onFileProcessed: (info) => send({ type: 'collection_file_processed', ...info }),
        }, signal);

      } else {
        // Mixed — process each group
        const files = fs.readdirSync(path.join(batchDir, 'originals'));
        const groups = groupFilesByType(files);

        if (groups.images.length > 0) {
          await transcribeImages(batchManifest, batchDir, profileDir, {
            onPageTranscribed: (info) => send({ type: 'collection_file_processed', ...info }),
            onToolActivity: (info) => send({ type: 'collection_tool_activity', ...info }),
          }, signal);
          const anchors = interpolateDates(batchManifest, batchDir);
          if (anchors.length > 0) batchManifest.anchorDates = anchors;
        }
        if (groups.audio.length > 0) {
          await transcribeAudio(batchManifest, batchDir, {
            onFileProcessed: (info) => send({ type: 'collection_file_processed', ...info }),
          }, signal);
        }
        if (groups.text.length > 0) {
          await processTextFiles(batchManifest, batchDir, {
            onFileProcessed: (info) => send({ type: 'collection_file_processed', ...info }),
          }, signal);
        }
      }

      send({ type: 'collection_phase_complete', phase: 'transcribing', next: 'assembling' });

      // Phase 2: Assembly
      batchManifest.phase = 'assembling';
      manifests.saveManifest(batchDir, batchManifest);
      send({ type: 'collection_progress', phase: 'assembling', currentFile: 0, totalFiles: batchManifest.fileCount });

      const prompt = buildAssemblyPrompt(collectionManifest, batchManifest);
      await spawnClaudeWorker(prompt, batchDir, {
        allowedTools: ['Write', 'Read', 'Glob', 'Grep'],
        maxTurns: Math.max(30, batchManifest.fileCount + 10),
        permissionMode: 'bypassPermissions',
        onFileCreated: (info) => send({ type: 'collection_file_created', ...info }),
        onToolActivity: (info) => send({ type: 'collection_tool_activity', ...info }),
        signal,
      });

      batchManifest.checkpoint.assembled = true;
      manifests.saveManifest(batchDir, batchManifest);
      send({ type: 'collection_phase_complete', phase: 'assembling', next: 'synthesizing' });
    }

    // Phase 3: Synthesis
    if (!batchManifest.checkpoint.synthesized) {
      batchManifest.phase = 'synthesizing';
      manifests.saveManifest(batchDir, batchManifest);
      send({ type: 'collection_progress', phase: 'synthesizing', currentFile: 0, totalFiles: batchManifest.fileCount });

      await synthesizeBatch(collectionManifest, batchManifest, profileDir, {
        onFileCreated: (info) => send({ type: 'collection_synthesis_update', ...info }),
        onToolActivity: (info) => send({ type: 'collection_tool_activity', ...info }),
      }, signal);

      batchManifest.checkpoint.synthesized = true;
      batchManifest.status = 'complete';
      batchManifest.phase = 'idle';
      batchManifest.completedAt = new Date().toISOString();
      manifests.saveManifest(batchDir, batchManifest);

      // Update collection-level
      const batchEntry = collectionManifest.batches.find(b => b.slug === session.batchSlug);
      if (batchEntry) batchEntry.status = 'complete';
      const allDone = collectionManifest.batches.every(b => b.status === 'complete');
      collectionManifest.status = allDone ? 'complete' : 'idle';
      manifests.saveManifest(collectionDir, collectionManifest);

      // Update collection context if multiple batches
      await updateCollectionContext(collectionDir, profileDir, {
        onFileCreated: (info) => send({ type: 'collection_synthesis_update', ...info }),
      }, signal);
    }

    send({
      type: 'collection_complete',
      collectionId: session.collectionId,
      batchSlug: session.batchSlug,
      filesProcessed: batchManifest.fileCount,
    });
  } catch (err) {
    send({ type: 'collection_error', message: `Pipeline failed: ${err.message}` });
    batchManifest.status = 'failed';
    manifests.saveManifest(batchDir, batchManifest);
  }

  activeSession = null;
}

// --- Resume ---

export async function resumeBatch(ws, collectionId, batchSlug, profilesDir) {
  const coll = manifests.findCollection(collectionId, profilesDir);
  if (!coll) throw new Error('Collection not found');

  const batch = manifests.findBatch(coll.dir, batchSlug);
  if (!batch || batch.manifest.status === 'complete') throw new Error('Batch not found or already complete');

  activeSession = {
    collectionId, batchSlug, collectionDir: coll.dir, batchDir: batch.dir,
    collectionManifest: coll.manifest, batchManifest: batch.manifest,
    abortController: new AbortController(),
  };

  await runBatchPipeline(ws, profilesDir);
}

// --- Query ---

export { listCollections } from './collection-manifest.js';

export function getCollection(collectionId, profilesDir) {
  const coll = manifests.findCollection(collectionId, profilesDir);
  if (!coll) throw new Error('Collection not found');

  // Include batch details
  const batchesDir = path.join(coll.dir, 'batches');
  const batchDetails = [];
  if (fs.existsSync(batchesDir)) {
    for (const slug of fs.readdirSync(batchesDir)) {
      const batchDir = path.join(batchesDir, slug);
      if (!fs.statSync(batchDir).isDirectory()) continue;
      const bm = manifests.loadManifest(batchDir);
      if (bm) batchDetails.push(bm);
    }
  }

  // Read context.md if it exists
  const contextPath = path.join(coll.dir, 'context.md');
  const context = fs.existsSync(contextPath) ? fs.readFileSync(contextPath, 'utf-8') : '';

  return { ...coll.manifest, batches: batchDetails, context };
}

export function getBatchContent(collectionId, batchSlug, profilesDir) {
  const coll = manifests.findCollection(collectionId, profilesDir);
  if (!coll) throw new Error('Collection not found');

  const batch = manifests.findBatch(coll.dir, batchSlug);
  if (!batch) throw new Error('Batch not found');

  const fullTextPath = path.join(batch.dir, 'full-text.md');
  const content = fs.existsSync(fullTextPath) ? fs.readFileSync(fullTextPath, 'utf-8') : '';
  return { name: batch.manifest.name, content, manifest: batch.manifest };
}

export function updateCollectionContextFile(collectionId, content, profilesDir) {
  const coll = manifests.findCollection(collectionId, profilesDir);
  if (!coll) throw new Error('Collection not found');
  const contextPath = path.join(coll.dir, 'context.md');
  fs.writeFileSync(contextPath, content, 'utf-8');
}

export function updateCollectionMetadata(collectionId, updates, profilesDir) {
  const coll = manifests.findCollection(collectionId, profilesDir);
  if (!coll) throw new Error('Collection not found');
  if (updates.name) coll.manifest.name = updates.name;
  if (updates.description !== undefined) coll.manifest.description = updates.description;
  manifests.saveManifest(coll.dir, coll.manifest);
  return coll.manifest;
}

export function updateBatchMetadata(collectionId, batchSlug, updates, profilesDir) {
  const coll = manifests.findCollection(collectionId, profilesDir);
  if (!coll) throw new Error('Collection not found');
  const batch = manifests.findBatch(coll.dir, batchSlug);
  if (!batch) throw new Error('Batch not found');
  for (const key of ['name', 'description', 'timeline', 'lifeStage', 'physicalDescription']) {
    if (updates[key] !== undefined) batch.manifest[key] = updates[key];
  }
  manifests.saveManifest(batch.dir, batch.manifest);
  return batch.manifest;
}

export function abort(ws) {
  if (activeSession) {
    activeSession.abortController.abort();
    activeSession = null;
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'collection_aborted' }));
  }
}
