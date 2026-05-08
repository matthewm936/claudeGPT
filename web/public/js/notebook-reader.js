/**
 * Full-screen notebook reader — page navigation, metadata editing, AI ingestion.
 */

import { state } from './state.js';
import { send } from './ws.js';
import { escapeHtml } from './utils.js';

let readerOverlay = null;
let currentArtifact = null; // { artifactId, name, content, manifest }

export function openReader(msg) {
  currentArtifact = msg;
  if (readerOverlay) { readerOverlay.remove(); readerOverlay = null; }
  readerOverlay = buildReader(msg);
  document.body.appendChild(readerOverlay);
}

export function closeReader() {
  if (readerOverlay) { readerOverlay.classList.add('fading'); setTimeout(() => { readerOverlay?.remove(); readerOverlay = null; }, 400); }
  currentArtifact = null;
}

function buildReader(msg) {
  const pages = parsePages(msg.content);
  const m = msg.manifest || {};
  const div = document.createElement('div');
  div.id = 'notebook-reader';

  div.innerHTML = `
    <div class="reader-toolbar">
      <span class="reader-title">${escapeHtml(msg.name || 'Notebook')}</span>
      <div class="reader-page-nav">
        <button class="reader-page-btn active" data-page="all">All</button>
        ${pages.map((p, i) => `<button class="reader-page-btn" data-page="${i}">${i + 1}</button>`).join('')}
      </div>
      <button class="reader-close">&times;</button>
    </div>
    <div class="reader-body">
      <div class="reader-content">
        <div class="reader-text markdown-content">${marked.parse(msg.content || '')}</div>
      </div>
      <div class="reader-panel">
        <div class="reader-panel-section">
          <h3>About this notebook</h3>
          <div class="artifact-form">
            <div class="artifact-field">
              <label>Name</label>
              <input type="text" id="reader-name" value="${escapeHtml(m.name || msg.name || '')}" disabled>
            </div>
            <div class="artifact-field">
              <label>Rough timeline</label>
              <input type="text" id="reader-timeline" value="${escapeHtml(m.timeline || '')}">
            </div>
            <div class="artifact-field">
              <label>What's in it?</label>
              <textarea id="reader-description" rows="2">${escapeHtml(m.description || '')}</textarea>
            </div>
            <div class="artifact-field">
              <label>Physical description</label>
              <input type="text" id="reader-physical" value="${escapeHtml(m.physicalDescription || '')}">
            </div>
            <div class="artifact-field">
              <label>Where were you in life?</label>
              <textarea id="reader-life-stage" rows="2">${escapeHtml(m.lifeStage || '')}</textarea>
            </div>
            <div class="artifact-field">
              <label>Anything else the AI should know?</label>
              <textarea id="reader-notes" placeholder="Context, corrections, things the transcription missed..." rows="2">${escapeHtml(m.reviewNotes || '')}</textarea>
            </div>
          </div>
          <div class="reader-panel-actions">
            <button class="artifact-btn secondary" id="reader-save">Save</button>
            <span id="reader-saved" class="review-saved hidden">Saved</span>
          </div>
        </div>
        <div class="reader-panel-section">
          <button class="artifact-btn primary reader-ingest-btn" id="reader-ingest">Talk to AI about this</button>
        </div>
      </div>
    </div>`;

  // Page navigation
  div.querySelectorAll('.reader-page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      div.querySelectorAll('.reader-page-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.page;
      const textEl = div.querySelector('.reader-text');
      if (page === 'all') {
        textEl.innerHTML = marked.parse(msg.content || '');
      } else {
        const idx = parseInt(page, 10);
        if (pages[idx]) textEl.innerHTML = marked.parse(pages[idx].content);
      }
      textEl.scrollTop = 0;
    });
  });

  // Close
  div.querySelector('.reader-close').addEventListener('click', closeReader);

  // Save metadata
  div.querySelector('#reader-save').addEventListener('click', () => {
    const updates = {
      timeline: div.querySelector('#reader-timeline')?.value.trim() || '',
      description: div.querySelector('#reader-description')?.value.trim() || '',
      physicalDescription: div.querySelector('#reader-physical')?.value.trim() || '',
      lifeStage: div.querySelector('#reader-life-stage')?.value.trim() || '',
      reviewNotes: div.querySelector('#reader-notes')?.value.trim() || '',
    };
    send({ type: 'update_artifact_metadata', artifactId: msg.artifactId, updates });
    // Update local reference
    if (currentArtifact?.manifest) Object.assign(currentArtifact.manifest, updates);
    const saved = div.querySelector('#reader-saved');
    if (saved) { saved.classList.remove('hidden'); setTimeout(() => saved.classList.add('hidden'), 2000); }
  });

  // Talk to AI
  div.querySelector('#reader-ingest').addEventListener('click', () => {
    const m = currentArtifact?.manifest || {};
    const slug = m.slug || '';
    const parts = [`I just digitized a physical notebook: "${m.name || 'untitled'}".`];
    if (m.timeline) parts.push(`Timeline: ${m.timeline}.`);
    if (m.description) parts.push(`Contents: ${m.description}.`);
    if (m.lifeStage) parts.push(`Where I was in life: ${m.lifeStage}.`);
    if (m.reviewNotes) parts.push(`Additional context: ${m.reviewNotes}.`);
    parts.push(`Read the full notebook at data/artifacts/notebooks/${slug}/full-text.md and tell me what you see — what patterns, what threads, what stands out. Then file anything important into my KB.`);

    closeReader();
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.value = parts.join(' ');
      chatInput.dispatchEvent(new Event('input'));
      chatInput.focus();
    }
  });

  // Esc to close
  const escHandler = (e) => { if (e.key === 'Escape') { closeReader(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  return div;
}

/**
 * Split full-text.md into individual page sections by ## Page N headers.
 */
function parsePages(content) {
  if (!content) return [];
  const sections = content.split(/(?=^## Page \d+)/m);
  return sections
    .filter(s => /^## Page \d+/.test(s))
    .map(s => {
      const match = s.match(/^## Page (\d+)/);
      return { number: match ? parseInt(match[1], 10) : 0, content: s };
    });
}
