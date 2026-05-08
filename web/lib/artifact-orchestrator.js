/**
 * Central coordinator for physical artifact ingestion.
 * Manages upload, transcription, assembly, and KB filing pipeline.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as profiles from './profiles.js';
import { transcribePages } from './artifact-transcribe.js';
import { interpolateDates, assembleJournal, fileIntoKb } from './artifact-assembly.js';

let artifactSession = null;

export function getSession() { return artifactSession; }
export function clearSession() { artifactSession = null; }

function artifactsDir(profilesDir) {
  return path.join(profiles.getDir(profilesDir), 'data', 'artifacts', 'notebooks');
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function loadManifest(dir) {
  const mp = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mp)) return null;
  return JSON.parse(fs.readFileSync(mp, 'utf-8'));
}

function saveManifest(dir, manifest) {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

// --- Upload ---

export function handleUploadStart(ws, metadata, profilesDir) {
  const slug = slugify(metadata.name);
  const id = crypto.randomUUID();
  const dir = path.join(artifactsDir(profilesDir), slug);

  fs.mkdirSync(path.join(dir, 'originals'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'transcripts'), { recursive: true });

  const manifest = {
    id, slug,
    name: metadata.name,
    description: metadata.description || '',
    timeline: metadata.timeline || '',
    physicalDescription: metadata.physicalDescription || '',
    lifeStage: metadata.lifeStage || '',
    pageCount: 0,
    status: 'processing',
    phase: 'uploading',
    anchorDates: [],
    createdAt: new Date().toISOString(),
    completedAt: null,
    checkpoint: { lastTranscribedPage: 0, assembled: false, kbFiled: false },
  };

  saveManifest(dir, manifest);

  artifactSession = { artifactId: id, slug, dir, manifest, abortController: new AbortController() };

  ws.send(JSON.stringify({ type: 'artifact_upload_started', artifactId: id, slug }));
}

export function handleUploadPage(ws, artifactId, pageNumber, filename, imageData, profilesDir) {
  if (!artifactSession || artifactSession.artifactId !== artifactId) {
    ws.send(JSON.stringify({ type: 'artifact_error', message: 'No active upload session' }));
    return;
  }

  const ext = path.extname(filename).toLowerCase() || '.jpg';
  const pageName = `page-${String(pageNumber).padStart(3, '0')}${ext}`;
  const dest = path.join(artifactSession.dir, 'originals', pageName);

  fs.writeFileSync(dest, Buffer.from(imageData, 'base64'));

  ws.send(JSON.stringify({ type: 'artifact_page_received', page: pageNumber }));
}

export async function handleUploadComplete(ws, artifactId, totalPages, profilesDir) {
  if (!artifactSession || artifactSession.artifactId !== artifactId) {
    ws.send(JSON.stringify({ type: 'artifact_error', message: 'No active upload session' }));
    return;
  }

  artifactSession.manifest.pageCount = totalPages;
  artifactSession.manifest.phase = 'transcribing';
  saveManifest(artifactSession.dir, artifactSession.manifest);

  ws.send(JSON.stringify({
    type: 'artifact_uploaded',
    artifactId, slug: artifactSession.slug,
    name: artifactSession.manifest.name, pageCount: totalPages,
  }));

  // Start the full processing pipeline
  await runPipeline(ws, profilesDir);
}

// --- Processing Pipeline ---

async function runPipeline(ws, profilesDir) {
  const session = artifactSession;
  if (!session) return;

  const { dir, manifest } = session;
  const profileDir = profiles.getDir(profilesDir);
  const signal = session.abortController.signal;

  const send = (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  try {
    // Phase 1: Transcription
    if (!manifest.checkpoint.assembled) {
      manifest.phase = 'transcribing';
      saveManifest(dir, manifest);
      send({ type: 'artifact_progress', phase: 'transcribing', currentPage: 0, totalPages: manifest.pageCount });

      const result = await transcribePages(manifest, dir, {
        onPageTranscribed: (info) => {
          send({ type: 'artifact_page_transcribed', ...info });
          manifest.checkpoint.lastTranscribedPage = info.page;
          saveManifest(dir, manifest);
        },
        onBatchComplete: (info) => {
          send({ type: 'artifact_progress', phase: 'transcribing', currentPage: info.pagesTranscribed, totalPages: manifest.pageCount });
        },
        onAnchorDateFound: (info) => {
          manifest.anchorDates.push(info);
          saveManifest(dir, manifest);
          send({ type: 'artifact_anchor_date', ...info });
        },
        onToolActivity: (info) => send({ type: 'artifact_tool_activity', ...info }),
        onError: (msg) => send({ type: 'artifact_error', message: msg }),
      }, signal);

      send({ type: 'artifact_phase_complete', phase: 'transcribing', next: 'assembling' });

      // Phase 2: Date interpolation (instant, no Claude)
      const anchors = interpolateDates(manifest, dir);
      manifest.anchorDates = anchors.length > 0 ? anchors : manifest.anchorDates;
      saveManifest(dir, manifest);
    }

    // Phase 3: Assembly
    if (!manifest.checkpoint.assembled) {
      manifest.phase = 'assembling';
      saveManifest(dir, manifest);
      send({ type: 'artifact_progress', phase: 'assembling', currentPage: 0, totalPages: manifest.pageCount });

      await assembleJournal(manifest, profileDir, {
        onFileCreated: (info) => send({ type: 'artifact_file_created', ...info }),
        onToolActivity: (info) => send({ type: 'artifact_tool_activity', ...info }),
      }, signal);

      manifest.checkpoint.assembled = true;
      saveManifest(dir, manifest);
      send({ type: 'artifact_phase_complete', phase: 'assembling', next: 'filing' });
    }

    // Phase 4: KB Filing
    if (!manifest.checkpoint.kbFiled) {
      manifest.phase = 'filing';
      saveManifest(dir, manifest);
      send({ type: 'artifact_progress', phase: 'filing', currentPage: 0, totalPages: manifest.pageCount });

      const kbResult = await fileIntoKb(manifest, profileDir, {
        onFileCreated: (info) => send({ type: 'artifact_file_created', ...info }),
        onToolActivity: (info) => send({ type: 'artifact_tool_activity', ...info }),
      }, signal);

      manifest.checkpoint.kbFiled = true;
      manifest.status = 'complete';
      manifest.phase = 'idle';
      manifest.completedAt = new Date().toISOString();
      saveManifest(dir, manifest);
    }

    send({
      type: 'artifact_complete',
      artifactId: session.artifactId,
      pagesTranscribed: manifest.pageCount,
      filesCreated: 0, // approximate — tracked client-side
      anchorDates: manifest.anchorDates,
    });
  } catch (err) {
    send({ type: 'artifact_error', message: `Pipeline failed: ${err.message}` });
    manifest.status = 'failed';
    saveManifest(dir, manifest);
  }

  artifactSession = null;
}

// --- Resume ---

export async function resumeArtifact(ws, artifactId, profilesDir) {
  const base = artifactsDir(profilesDir);
  if (!fs.existsSync(base)) return false;

  for (const slug of fs.readdirSync(base)) {
    const dir = path.join(base, slug);
    const manifest = loadManifest(dir);
    if (manifest?.id === artifactId && manifest.status === 'processing') {
      artifactSession = { artifactId: manifest.id, slug, dir, manifest, abortController: new AbortController() };
      await runPipeline(ws, profilesDir);
      return true;
    }
  }
  return false;
}

// --- Query ---

export function listArtifacts(profilesDir) {
  const base = artifactsDir(profilesDir);
  if (!fs.existsSync(base)) return [];

  return fs.readdirSync(base)
    .map(slug => {
      const manifest = loadManifest(path.join(base, slug));
      if (!manifest) return null;
      return {
        id: manifest.id, slug: manifest.slug, name: manifest.name,
        status: manifest.status, phase: manifest.phase,
        pageCount: manifest.pageCount, timeline: manifest.timeline,
        anchorDates: manifest.anchorDates?.length || 0,
        createdAt: manifest.createdAt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function getDigitalJournal(artifactId, profilesDir) {
  const base = artifactsDir(profilesDir);
  if (!fs.existsSync(base)) throw new Error('No artifacts found');

  for (const slug of fs.readdirSync(base)) {
    const dir = path.join(base, slug);
    const manifest = loadManifest(dir);
    if (manifest?.id === artifactId) {
      const fullTextPath = path.join(dir, 'full-text.md');
      const content = fs.existsSync(fullTextPath) ? fs.readFileSync(fullTextPath, 'utf-8') : '';
      return { name: manifest.name, content, manifest };
    }
  }
  throw new Error('Artifact not found');
}

export function updateMetadata(artifactId, updates, profilesDir) {
  const base = artifactsDir(profilesDir);
  if (!fs.existsSync(base)) throw new Error('No artifacts found');

  for (const slug of fs.readdirSync(base)) {
    const dir = path.join(base, slug);
    const manifest = loadManifest(dir);
    if (manifest?.id === artifactId) {
      if (updates.timeline) manifest.timeline = updates.timeline;
      if (updates.description) manifest.description = updates.description;
      if (updates.lifeStage) manifest.lifeStage = updates.lifeStage;
      if (updates.reviewNotes) manifest.reviewNotes = updates.reviewNotes;
      saveManifest(dir, manifest);
      return manifest;
    }
  }
  throw new Error('Artifact not found');
}

export function abort(ws) {
  if (artifactSession) {
    artifactSession.abortController.abort();
    artifactSession = null;
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'artifact_aborted' }));
  }
}
