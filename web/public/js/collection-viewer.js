/**
 * Full-screen collection viewer — two-column layout.
 * Left: editable metadata, context, batch tabs.
 * Right: scrollable content reader with section nav.
 */

import { state } from './state.js';
import { send } from './ws.js';
import { escapeHtml } from './utils.js';
import { showCollectionWizard } from './collections.js';

let viewerOverlay = null;
let currentCollection = null;
let activeBatchSlug = null;

export function openCollectionViewer(msg) {
  currentCollection = msg;
  activeBatchSlug = null;
  if (viewerOverlay) { viewerOverlay.remove(); viewerOverlay = null; }
  viewerOverlay = buildViewer(msg);
  document.body.appendChild(viewerOverlay);

  // Auto-load first batch
  const batches = (msg.batches || []).filter(b => b.status === 'complete');
  if (batches.length > 0) {
    activeBatchSlug = batches[0].slug;
    highlightBatchTab(batches[0].slug);
    send({ type: 'read_batch', collectionId: msg.id, batchSlug: batches[0].slug });
  }
}

export function closeCollectionViewer() {
  if (viewerOverlay) {
    viewerOverlay.classList.add('fading');
    setTimeout(() => { viewerOverlay?.remove(); viewerOverlay = null; }, 400);
  }
  currentCollection = null;
  activeBatchSlug = null;
}

/** Called by router when batch_content arrives while viewer is open. */
export function loadBatchIntoViewer(msg) {
  if (!viewerOverlay) return;
  const textEl = viewerOverlay.querySelector('.viewer-text');
  const navEl = viewerOverlay.querySelector('.viewer-nav');
  if (!textEl || !navEl) return;

  textEl.innerHTML = marked.parse(msg.content || '');

  // Rebuild section nav
  const sections = parseSections(msg.content);
  navEl.innerHTML = `<button class="viewer-nav-btn active" data-section="all">All</button>` +
    sections.map((s, i) => `<button class="viewer-nav-btn" data-section="${i}">${escapeHtml(s.label)}</button>`).join('');

  navEl.querySelectorAll('.viewer-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navEl.querySelectorAll('.viewer-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const idx = btn.dataset.section;
      if (idx === 'all') {
        textEl.innerHTML = marked.parse(msg.content || '');
      } else {
        const s = sections[parseInt(idx, 10)];
        if (s) textEl.innerHTML = marked.parse(s.content);
      }
    });
  });
}

function highlightBatchTab(slug) {
  if (!viewerOverlay) return;
  viewerOverlay.querySelectorAll('.viewer-batch-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.batchSlug === slug);
  });
}

function buildViewer(msg) {
  const batches = (msg.batches || []).filter(b => b.status === 'complete');
  const div = document.createElement('div');
  div.id = 'collection-viewer';

  div.innerHTML = `
    <div class="viewer-toolbar">
      <span class="viewer-title">${escapeHtml(msg.name || 'Collection')}</span>
      <div class="viewer-nav"></div>
      <button class="collection-btn primary viewer-talk-btn" id="viewer-talk">Talk to AI about this</button>
      <button class="viewer-close">&times;</button>
    </div>
    <div class="viewer-body">
      <div class="viewer-sidebar">
        <div class="viewer-sidebar-section">
          <h3>Details</h3>
          <div class="collection-form">
            <div class="collection-field">
              <label>Name</label>
              <input type="text" id="viewer-coll-name" value="${escapeHtml(msg.name || '')}">
            </div>
            <div class="collection-field">
              <label>Description</label>
              <textarea id="viewer-coll-desc" rows="2">${escapeHtml(msg.description || '')}</textarea>
            </div>
          </div>
        </div>
        <div class="viewer-sidebar-section">
          <h3>Context</h3>
          <textarea id="viewer-coll-context" class="viewer-context-editor" rows="8">${escapeHtml(msg.context || '')}</textarea>
        </div>
        <div class="viewer-sidebar-section viewer-save-row">
          <button class="collection-btn primary" id="viewer-save-btn">Save changes</button>
        </div>
        <div class="viewer-sidebar-section">
          <h3>Batches</h3>
          <div class="viewer-batch-list">
            ${batches.map(b => `
              <div class="viewer-batch-tab" data-batch-slug="${escapeHtml(b.slug)}">
                <span class="viewer-batch-tab-name">${escapeHtml(b.name)}</span>
                ${b.timeline ? `<span class="viewer-batch-tab-meta">${escapeHtml(b.timeline)}</span>` : ''}
              </div>`).join('')}
            <div class="viewer-batch-add" id="viewer-add-batch">+ Add batch</div>
          </div>
        </div>
      </div>
      <div class="viewer-content">
        <div class="viewer-text markdown-content">
          <div class="viewer-empty-state">Select a batch to read</div>
        </div>
      </div>
    </div>`;

  // Batch tab clicks
  div.querySelectorAll('.viewer-batch-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const slug = tab.dataset.batchSlug;
      if (slug === activeBatchSlug) return;
      activeBatchSlug = slug;
      highlightBatchTab(slug);
      send({ type: 'read_batch', collectionId: msg.id, batchSlug: slug });
    });
  });

  // Add batch
  div.querySelector('#viewer-add-batch').addEventListener('click', () => {
    closeCollectionViewer();
    showCollectionWizard(msg.id);
  });

  // Save
  div.querySelector('#viewer-save-btn').addEventListener('click', () => {
    const name = div.querySelector('#viewer-coll-name').value.trim();
    const desc = div.querySelector('#viewer-coll-desc').value.trim();
    const context = div.querySelector('#viewer-coll-context').value;

    if (name) send({ type: 'update_collection_metadata', collectionId: msg.id, updates: { name, description: desc } });
    send({ type: 'update_collection_context', collectionId: msg.id, content: context });

    // Visual feedback
    const btn = div.querySelector('#viewer-save-btn');
    btn.textContent = 'Saved';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = 'Save changes'; btn.disabled = false; }, 1500);
  });

  // Close
  div.querySelector('.viewer-close').addEventListener('click', closeCollectionViewer);

  // Talk to AI
  div.querySelector('#viewer-talk').addEventListener('click', () => {
    const parts = [`I want to discuss my "${msg.name || 'collection'}" collection.`];
    if (msg.description) parts.push(`Contents: ${msg.description}.`);
    parts.push('Read the collection and tell me what stands out — patterns, threads, anything interesting.');

    closeCollectionViewer();
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.value = parts.join(' ');
      chatInput.dispatchEvent(new Event('input'));
      chatInput.focus();
    }
  });

  // Esc to close
  const escHandler = (e) => {
    if (e.key === 'Escape') { closeCollectionViewer(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  return div;
}

function parseSections(content) {
  if (!content) return [];
  const parts = content.split(/(?=^## )/m);
  return parts
    .filter(s => /^## /.test(s))
    .map(s => {
      const line = s.split('\n')[0];
      const label = line.replace(/^## /, '').slice(0, 30);
      return { label, content: s };
    });
}

/** Check if viewer is currently open (used by router). */
export function isViewerOpen() { return !!viewerOverlay; }
