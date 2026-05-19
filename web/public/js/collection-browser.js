/**
 * Collection browser — card-based list in the explorer sidebar.
 * Single click on a collection opens the full-screen viewer.
 */

import { state } from './state.js';
import { send } from './ws.js';
import { escapeHtml } from './utils.js';
import { showCollectionWizard } from './collections.js';
import { showOnboarding } from './onboarding.js';
import { showWelcomeGuide, removeWelcomeGuide } from './chat.js';

/**
 * Render collection cards in the explorer.
 */
export function renderCollectionList(collections) {
  state.collectionsList = collections;

  // Welcome guide only for truly empty profiles
  if (collections.length > 0) removeWelcomeGuide();
  else showWelcomeGuide();

  const list = document.getElementById('collections-list');
  if (!list) return;
  list.innerHTML = '';

  for (const c of collections) {
    const card = document.createElement('div');
    card.className = 'collection-card';
    card.dataset.collectionId = c.id;

    const metaParts = [];
    if (c.batchCount) metaParts.push(`${c.batchCount} batch${c.batchCount !== 1 ? 'es' : ''}`);

    const showStatus = c.status === 'processing' || c.status === 'failed';
    const isActive = c.status === 'complete' || c.status === 'idle';

    card.innerHTML = `
      <div class="collection-card-name">${escapeHtml(c.name)}</div>
      ${c.description ? `<div class="collection-card-desc">${escapeHtml(c.description)}</div>` : ''}
      <div class="collection-card-meta">
        ${isActive ? '<span class="ingested-label">active</span>' : ''}
        ${metaParts.map((p, i) =>
          `${(i > 0 || isActive) ? '<span class="meta-dot"></span>' : ''}${escapeHtml(p)}`
        ).join('')}
        ${showStatus ? `<span class="collection-card-status ${c.status}">${escapeHtml(c.status)}</span>` : ''}
      </div>`;

    // Single click → full-screen viewer
    card.addEventListener('click', () => {
      send({ type: 'get_collection', collectionId: c.id });
    });

    list.appendChild(card);
  }

  // Ghost add-card — always present
  const addCard = document.createElement('div');
  addCard.className = 'collection-add-card';
  addCard.textContent = '+ Add collection';
  addCard.addEventListener('click', () => showCollectionWizard());
  list.appendChild(addCard);
}

/**
 * Render the ChatGPT import checklist item below the file tree.
 * Always visible — unchecked when pending, checked + smaller when done.
 */
export function renderImportItem() {
  let el = document.getElementById('import-chatgpt-item');
  if (el) el.remove();

  const body = document.getElementById('explorer-body');
  if (!body) return;

  const done = state.chatgptImported;
  el = document.createElement('div');
  el.id = 'import-chatgpt-item';
  el.className = `import-checklist-item${done ? ' done' : ''}`;
  el.innerHTML = `<span class="import-check">${done ? '\u2713' : ''}</span><span class="import-label">Import ChatGPT conversations</span>`;
  if (!done) el.addEventListener('click', () => showOnboarding());
  body.appendChild(el);
}

/**
 * Set up event listeners for the collection browser.
 */
export function setupCollectionListeners() {
  setTimeout(() => send({ type: 'list_collections' }), 500);
}
