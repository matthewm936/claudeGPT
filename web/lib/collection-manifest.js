/**
 * Manifest CRUD for collections and batches.
 * Shared across all collection operations.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as profiles from './profiles.js';

export function collectionsDir(profilesDir) {
  return path.join(profiles.getDir(profilesDir), 'collections');
}

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export function loadManifest(dir) {
  const mp = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mp)) return null;
  return JSON.parse(fs.readFileSync(mp, 'utf-8'));
}

export function saveManifest(dir, manifest) {
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

export function createCollectionManifest(name, description) {
  return {
    id: crypto.randomUUID(),
    slug: slugify(name),
    name,
    description: description || '',
    status: 'idle',
    batches: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createBatchManifest(name, metadata) {
  return {
    id: crypto.randomUUID(),
    slug: slugify(name),
    name,
    description: metadata.description || '',
    fileType: metadata.fileType || 'mixed',
    timeline: metadata.timeline || '',
    lifeStage: metadata.lifeStage || '',
    physicalDescription: metadata.physicalDescription || '',
    fileCount: 0,
    status: 'uploading',
    phase: 'uploading',
    checkpoint: { lastProcessedFile: 0, assembled: false, synthesized: false },
    anchorDates: [],
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

export function listCollections(profilesDir) {
  const base = collectionsDir(profilesDir);
  if (!fs.existsSync(base)) return [];

  return fs.readdirSync(base)
    .map(slug => {
      const dir = path.join(base, slug);
      if (!fs.statSync(dir).isDirectory()) return null;
      const manifest = loadManifest(dir);
      if (!manifest) return null;
      return {
        id: manifest.id, slug: manifest.slug, name: manifest.name,
        description: manifest.description, status: manifest.status,
        batchCount: manifest.batches?.length || 0,
        createdAt: manifest.createdAt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function findCollection(collectionId, profilesDir) {
  const base = collectionsDir(profilesDir);
  if (!fs.existsSync(base)) return null;

  for (const slug of fs.readdirSync(base)) {
    const dir = path.join(base, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    const manifest = loadManifest(dir);
    if (manifest?.id === collectionId) return { dir, manifest };
  }
  return null;
}

export function findBatch(collectionDir, batchSlug) {
  const dir = path.join(collectionDir, 'batches', batchSlug);
  if (!fs.existsSync(dir)) return null;
  const manifest = loadManifest(dir);
  return manifest ? { dir, manifest } : null;
}
