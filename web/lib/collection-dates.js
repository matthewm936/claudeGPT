/**
 * Date interpolation for image-based collections.
 * Pure Node.js — no Claude CLI needed.
 * Interpolates undated pages between anchor dates.
 */

import fs from 'fs';
import path from 'path';

/**
 * Read front matter from a transcript file.
 */
function readTranscriptMeta(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const meta = {};
    for (const line of match[1].split('\n')) {
      const [key, ...rest] = line.split(':');
      if (key && rest.length) meta[key.trim()] = rest.join(':').trim();
    }

    return {
      page: parseInt(meta.page, 10),
      date: meta.date || '',
      date_source: meta.date_source || 'none',
      has_date: meta.has_date === 'true',
    };
  } catch { return null; }
}

/**
 * Write updated front matter to a transcript file, preserving content.
 */
function updateTranscriptMeta(filePath, updates) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return;

  const meta = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) meta[key.trim()] = rest.join(':').trim();
  }

  Object.assign(meta, updates);

  const newFrontMatter = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n');
  const body = content.slice(match[0].length);
  fs.writeFileSync(filePath, `---\n${newFrontMatter}\n---${body}`);
}

/**
 * Interpolate dates for undated pages using anchor dates and timeline bounds.
 * Returns the anchorDates array found.
 */
export function interpolateDates(manifest, batchDir) {
  const transcriptsDir = path.join(batchDir, 'transcripts');
  if (!fs.existsSync(transcriptsDir)) return [];

  const files = fs.readdirSync(transcriptsDir).filter(f => f.endsWith('.md')).sort();
  const pages = [];

  for (const file of files) {
    const meta = readTranscriptMeta(path.join(transcriptsDir, file));
    if (meta) pages.push({ ...meta, file });
  }

  if (pages.length === 0) return [];

  // Find anchor dates (explicit)
  const anchors = pages.filter(p => p.has_date && p.date).map(p => ({
    page: p.page,
    date: p.date,
    source: 'written-on-page',
  }));

  const dateMap = new Map();
  for (const a of anchors) {
    const d = new Date(a.date);
    if (!isNaN(d)) dateMap.set(a.page, d.getTime());
  }

  // Extract year bounds from timeline string
  const timeline = typeof manifest.timeline === 'string' ? manifest.timeline : '';
  const yearMatches = timeline.match(/\b(19|20)\d{2}\b/g);
  if (yearMatches && yearMatches.length > 0 && !dateMap.has(1)) {
    const d = new Date(`${yearMatches[0]}-01-01`);
    if (!isNaN(d)) dateMap.set(0, d.getTime());
  }
  if (yearMatches && yearMatches.length > 1 && !dateMap.has(pages.length)) {
    const d = new Date(`${yearMatches[yearMatches.length - 1]}-12-28`);
    if (!isNaN(d)) dateMap.set(pages.length + 1, d.getTime());
  }

  const anchorPages = [...dateMap.keys()].sort((a, b) => a - b);
  if (anchorPages.length < 2) return anchors;

  // Interpolate undated pages
  for (const p of pages) {
    if (dateMap.has(p.page)) continue;

    let before = null, after = null;
    for (const ap of anchorPages) {
      if (ap <= p.page) before = ap;
      if (ap >= p.page && after === null) after = ap;
    }

    if (before !== null && after !== null && before !== after) {
      const startMs = dateMap.get(before);
      const endMs = dateMap.get(after);
      const ratio = (p.page - before) / (after - before);
      const interpolatedMs = startMs + ratio * (endMs - startMs);
      const interpolatedDate = new Date(interpolatedMs).toISOString().split('T')[0];

      updateTranscriptMeta(path.join(transcriptsDir, p.file), {
        date: interpolatedDate,
        date_source: 'interpolated',
        date_confidence: 'medium',
      });
    }
  }

  return anchors;
}
