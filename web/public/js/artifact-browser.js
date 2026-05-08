/**
 * Artifact browser — sidebar journal list + digital journal viewing.
 */

import { state } from './state.js';
import { send } from './ws.js';
import { escapeHtml } from './utils.js';
import { showArtifactWizard } from './artifacts.js';
import { openReader } from './notebook-reader.js';

/**
 * Render the artifact list in the sidebar.
 */
export function renderArtifactList(artifacts) {
  state.artifactsList = artifacts;
  const section = document.getElementById('artifacts-section');
  const list = document.getElementById('artifacts-list');
  if (!section || !list) return;

  // Always show the section — the "+" button needs to be accessible even with no journals
  section.classList.remove('hidden');
  list.innerHTML = '';

  if (artifacts.length === 0) return;

  for (const a of artifacts) {
    const item = document.createElement('div');
    item.className = 'artifact-list-item';
    item.dataset.artifactId = a.id;

    const statusClass = a.status === 'complete' ? 'complete' : a.status === 'processing' ? 'processing' : 'failed';
    const statusLabel = a.status === 'complete' ? 'done' : a.status === 'processing' ? a.phase : 'failed';
    const timeline = typeof a.timeline === 'string' ? a.timeline : '';
    const meta = [timeline, `${a.pageCount} pages`].filter(Boolean).join(' · ');

    item.innerHTML = `
      <div class="artifact-list-info">
        <div class="artifact-list-name">${escapeHtml(a.name)}</div>
        <div class="artifact-list-meta">${escapeHtml(meta)}</div>
      </div>
      <span class="artifact-status-badge ${statusClass}">${escapeHtml(statusLabel)}</span>`;

    item.addEventListener('click', () => {
      if (a.status === 'complete') {
        send({ type: 'read_artifact', artifactId: a.id });
      }
    });

    list.appendChild(item);
  }
}

/**
 * Handle artifact content received — open in full-screen reader.
 */
export function showDigitalJournal(msg) {
  openReader(msg);
}

/**
 * Set up event listeners for the artifact browser.
 */
export function setupArtifactListeners() {
  const btn = document.getElementById('new-artifact-btn');
  if (btn) btn.addEventListener('click', showArtifactWizard);

  // Request artifact list on load
  setTimeout(() => send({ type: 'list_artifacts' }), 500);
}
