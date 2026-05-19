/**
 * Collection wizard — multi-step UI for creating collections,
 * adding batches, uploading files of any type, and processing.
 */

import { state } from './state.js';
import { send } from './ws.js';
import { escapeHtml } from './utils.js';

let currentStep = 1;
let selectedFiles = [];
let textEntries = [];
let overlay = null;
let existingCollectionId = null;

const FILE_EXTS = /\.(jpg|jpeg|png|heic|webp|tiff|bmp|m4a|mp3|wav|ogg|flac|aac|txt|md|rtf|csv|json|pdf|zip)$/i;

// --- Wizard lifecycle ---

export function showCollectionWizard(collectionId = null) {
  existingCollectionId = collectionId;
  if (document.getElementById('collection-overlay')) {
    document.getElementById('collection-overlay').classList.remove('hidden');
    return;
  }
  overlay = createOverlay();
  document.body.appendChild(overlay);
  goToStep(1);
}

export function hideCollectionWizard() {
  const el = document.getElementById('collection-overlay');
  if (el) { el.classList.add('fading'); setTimeout(() => el.remove(), 400); }
  overlay = null;
  currentStep = 1;
  selectedFiles = [];
  textEntries = [];
  existingCollectionId = null;
  state.collectionSession = null;
}

function createOverlay() {
  const isAddBatch = !!existingCollectionId;
  const div = document.createElement('div');
  div.id = 'collection-overlay';
  div.innerHTML = `
    <div id="collection-container">
      <div class="collection-steps">
        <div class="collection-step-dot active current" data-step="1">1</div>
        <div class="collection-step-line"></div>
        <div class="collection-step-dot" data-step="2">2</div>
        <div class="collection-step-line"></div>
        <div class="collection-step-dot" data-step="3">3</div>
      </div>

      <!-- Step 1: Setup (two columns) -->
      <div class="collection-step active" id="collection-step-1">
        <h1>${isAddBatch ? 'Add a batch' : 'New collection'}</h1>
        <p class="collection-subtitle">${isAddBatch ? 'Tell us about this batch and drop the files.' : 'Give the AI some context, drop your files, and hit start.'}</p>
        <div class="wizard-columns">
          <div class="wizard-col-left">
            <div class="collection-form">
              ${!isAddBatch ? `<div class="collection-field">
                <label>Collection name</label>
                <input type="text" id="collection-name" placeholder="Journals, Dream Journal, Bar Game Notes...">
              </div>
              <div class="collection-field">
                <label>What is this collection?</label>
                <textarea id="collection-description" placeholder="A sentence or two about what this collection holds..." rows="2"></textarea>
              </div>` : `<div class="collection-field">
                <label>Batch name</label>
                <input type="text" id="batch-name" placeholder="Blue spiral notebook, March recordings...">
              </div>`}
              <div class="collection-field">
                <label>Rough timeline</label>
                <input type="text" id="batch-timeline" placeholder="Spring 2014, last summer, January 2023...">
                <span class="field-hint">As vague or specific as you want</span>
              </div>
              <div class="collection-field">
                <label>Where were you in life?</label>
                <input type="text" id="batch-life-stage" placeholder="College years, first job, living abroad...">
              </div>
            </div>
          </div>
          <div class="wizard-col-right">
            <div class="input-mode-toggle">
              <button type="button" class="mode-btn active" data-mode="files">Files</button>
              <button type="button" class="mode-btn" data-mode="text">Text</button>
            </div>
            <div id="input-mode-files" class="input-mode active">
              <div id="collection-dropzone">
                <div class="collection-dropzone-icon">&#128193;</div>
                <p>Drop files or folders</p>
                <p class="collection-dropzone-hint">Voice memos, PDFs, scanned notebooks, text, images, zips</p>
                <input type="file" id="collection-file-input" multiple style="display:none">
                <input type="file" id="collection-folder-input" webkitdirectory style="display:none">
                <div class="collection-dropzone-actions">
                  <button type="button" class="dropzone-browse" id="browse-files-btn">Browse files</button>
                  <button type="button" class="dropzone-browse" id="browse-folder-btn">Browse folder</button>
                </div>
              </div>
              <div id="collection-file-count" class="hidden"></div>
              <div id="collection-file-list" class="hidden"></div>
            </div>
            <div id="input-mode-text" class="input-mode">
              <div id="text-entries-list"></div>
              <div id="text-entry-compose">
                <textarea id="text-entry-area" placeholder="Paste or type text here..." rows="6"></textarea>
                <button type="button" class="text-entry-add-btn" id="add-text-btn">+ Add entry</button>
              </div>
            </div>
          </div>
        </div>
        <div class="collection-actions">
          <button class="collection-btn primary" id="collection-start" disabled>Start processing</button>
          <button class="collection-btn secondary" id="collection-cancel">Cancel</button>
        </div>
      </div>

      <!-- Step 2: Processing -->
      <div class="collection-step" id="collection-step-2">
        <div class="collection-progress-header">
          <div class="collection-progress-phase"><span class="pulse-dot"></span> <span id="collection-phase-label">Uploading files...</span></div>
          <div class="collection-progress-count" id="collection-progress-num">0</div>
          <div class="collection-progress-label" id="collection-progress-denom">of 0 files</div>
        </div>
        <div id="collection-progress-bar"><div id="collection-progress-fill"></div></div>
        <div id="collection-activity" class="hidden"></div>
        <div id="collection-transcript-preview" class="hidden"></div>
        <div id="collection-synthesis-feed" class="hidden"></div>
      </div>

      <!-- Step 3: Complete -->
      <div class="collection-step" id="collection-step-3">
        <h1>Collection processed</h1>
        <p class="collection-subtitle">Your content has been transcribed, assembled, and synthesized into your knowledge base.</p>
        <div class="collection-completion-cta">
          <button class="collection-btn primary collection-talk-btn" id="collection-talk-btn">Talk to AI about this</button>
          <p class="collection-talk-hint">Explore patterns, threads, and connections the AI found</p>
        </div>
        <div class="collection-completion-stats">
          <div class="collection-stat"><span class="stat-value" id="collection-stat-files">0</span><span class="stat-label">Files</span></div>
          <div class="collection-stat"><span class="stat-value" id="collection-stat-synthesis">0</span><span class="stat-label">KB updates</span></div>
        </div>
        <div class="collection-actions">
          <button class="collection-btn secondary" id="collection-read-btn">View collection</button>
          <button class="collection-btn secondary" id="collection-done-btn">Done</button>
        </div>
      </div>
    </div>`;

  // Step 1 bindings — dropzone
  const dz = div.querySelector('#collection-dropzone');
  const fi = div.querySelector('#collection-file-input');
  const fd = div.querySelector('#collection-folder-input');
  div.querySelector('#browse-files-btn').addEventListener('click', (e) => { e.stopPropagation(); fi.click(); });
  div.querySelector('#browse-folder-btn').addEventListener('click', (e) => { e.stopPropagation(); fd.click(); });
  dz.addEventListener('click', (e) => { if (e.target === dz || e.target.closest('.collection-dropzone-icon') || e.target.tagName === 'P') fi.click(); });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
  fi.addEventListener('change', () => { if (fi.files.length) handleFiles(fi.files); });
  fd.addEventListener('change', () => { if (fd.files.length) handleFiles(fd.files); });

  // Mode toggle
  div.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      div.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      div.querySelectorAll('.input-mode').forEach(m => m.classList.remove('active'));
      div.querySelector(`#input-mode-${btn.dataset.mode}`).classList.add('active');
    });
  });

  // Text entry bindings
  div.querySelector('#add-text-btn').addEventListener('click', () => addTextEntry());
  div.querySelector('#text-entry-area').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addTextEntry();
  });

  div.querySelector('#collection-start').addEventListener('click', startUpload);
  div.querySelector('#collection-cancel').addEventListener('click', hideCollectionWizard);

  // Step 3 bindings
  div.querySelector('#collection-done-btn').addEventListener('click', () => { hideCollectionWizard(); send({ type: 'list_collections' }); });
  div.querySelector('#collection-read-btn').addEventListener('click', () => {
    if (state.collectionSession?.collectionId) send({ type: 'get_collection', collectionId: state.collectionSession.collectionId });
    hideCollectionWizard();
  });
  div.querySelector('#collection-talk-btn').addEventListener('click', () => {
    const meta = state.collectionSession?.metadata;
    const parts = [`I want to discuss my "${meta?.name || 'collection'}" collection.`];
    if (meta?.timeline) parts.push(`Timeline: ${meta.timeline}.`);
    parts.push('Read the collection and tell me what stands out — patterns, threads, anything interesting.');
    hideCollectionWizard();
    send({ type: 'list_collections' });
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.value = parts.join(' ');
      chatInput.dispatchEvent(new Event('input'));
      chatInput.focus();
    }
  });

  return div;
}

// --- Step navigation ---

function goToStep(n) {
  currentStep = n;
  if (!overlay) return;
  overlay.querySelectorAll('.collection-step').forEach((s, i) => s.classList.toggle('active', i === n - 1));
  overlay.querySelectorAll('.collection-step-dot').forEach((d, i) => { d.classList.toggle('active', i < n); d.classList.toggle('current', i === n - 1); });
}

// --- Text entries ---

function addTextEntry() {
  const area = overlay.querySelector('#text-entry-area');
  const text = area.value.trim();
  if (!text) return;

  textEntries.push(text);
  area.value = '';
  renderTextEntries();
  updateStartButton();
}

function renderTextEntries() {
  const list = overlay.querySelector('#text-entries-list');
  list.innerHTML = '';
  textEntries.forEach((text, i) => {
    const card = document.createElement('div');
    card.className = 'text-entry-card';
    card.innerHTML = `<div class="text-entry-body">${escapeHtml(text)}</div><button class="text-entry-remove" data-idx="${i}">&times;</button>`;
    card.querySelector('.text-entry-remove').addEventListener('click', () => {
      textEntries.splice(i, 1);
      renderTextEntries();
      updateStartButton();
    });
    list.appendChild(card);
  });
}

function updateStartButton() {
  const btn = overlay.querySelector('#collection-start');
  if (btn) btn.disabled = selectedFiles.length === 0 && textEntries.length === 0;
}

// --- File handling ---

function handleFiles(fileList) {
  selectedFiles = [...fileList].filter(f => FILE_EXTS.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (selectedFiles.length === 0) return;

  const countEl = overlay.querySelector('#collection-file-count');
  const listEl = overlay.querySelector('#collection-file-list');
  countEl.classList.remove('hidden');
  listEl.classList.remove('hidden');
  countEl.textContent = `${selectedFiles.length} files`;

  const groups = { images: [], audio: [], text: [], documents: [], archives: [] };
  selectedFiles.forEach(f => {
    if (/\.(jpg|jpeg|png|heic|webp|tiff|bmp)$/i.test(f.name)) groups.images.push(f);
    else if (/\.(m4a|mp3|wav|ogg|flac|aac)$/i.test(f.name)) groups.audio.push(f);
    else if (/\.pdf$/i.test(f.name)) groups.documents.push(f);
    else if (/\.zip$/i.test(f.name)) groups.archives.push(f);
    else groups.text.push(f);
  });

  let html = '';
  if (groups.images.length) html += `<div class="file-group"><span class="file-group-label">${groups.images.length} images</span></div>`;
  if (groups.audio.length) html += `<div class="file-group"><span class="file-group-label">${groups.audio.length} audio</span></div>`;
  if (groups.documents.length) html += `<div class="file-group"><span class="file-group-label">${groups.documents.length} PDFs</span></div>`;
  if (groups.text.length) html += `<div class="file-group"><span class="file-group-label">${groups.text.length} text</span></div>`;
  if (groups.archives.length) html += `<div class="file-group"><span class="file-group-label">${groups.archives.length} archives</span></div>`;
  listEl.innerHTML = html;
  updateStartButton();
}

// --- Upload ---

async function startUpload() {
  const isAddBatch = !!existingCollectionId;

  // Validate required field
  if (isAddBatch) {
    const name = overlay.querySelector('#batch-name')?.value.trim();
    if (!name) { overlay.querySelector('#batch-name')?.focus(); return; }
  } else {
    const name = overlay.querySelector('#collection-name')?.value.trim();
    if (!name) { overlay.querySelector('#collection-name')?.focus(); return; }
  }

  // Convert text entries to File objects
  textEntries.forEach((text, i) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const name = `pasted-text-${String(i + 1).padStart(2, '0')}.txt`;
    selectedFiles.push(new File([blob], name, { type: 'text/plain' }));
  });

  const totalFiles = selectedFiles.length;
  goToStep(2);
  overlay.querySelector('#collection-phase-label').textContent = 'Uploading files...';
  overlay.querySelector('#collection-progress-denom').textContent = `of ${totalFiles} files`;

  const batchName = isAddBatch
    ? overlay.querySelector('#batch-name').value.trim()
    : overlay.querySelector('#collection-name').value.trim();
  const batchMeta = {
    name: batchName,
    description: '',
    timeline: overlay.querySelector('#batch-timeline')?.value.trim() || '',
    lifeStage: overlay.querySelector('#batch-life-stage')?.value.trim() || '',
  };

  state.collectionSession = { metadata: batchMeta, totalFiles, synthesisUpdates: 0 };

  if (!isAddBatch) {
    const collMeta = {
      name: overlay.querySelector('#collection-name').value.trim(),
      description: overlay.querySelector('#collection-description')?.value.trim() || '',
    };
    send({ type: 'create_collection', metadata: collMeta, batchMetadata: batchMeta });
  } else {
    send({ type: 'add_batch', collectionId: existingCollectionId, metadata: batchMeta });
  }
}

// --- Router callbacks ---

export function onCollectionCreated(msg) {
  if (!state.collectionSession) return;
  state.collectionSession.collectionId = msg.collectionId;
  state.collectionSession.slug = msg.slug;
  const batchMeta = state.collectionSession.metadata;
  send({ type: 'add_batch', collectionId: msg.collectionId, metadata: batchMeta });
}

export function onBatchCreated(msg) {
  if (!state.collectionSession) return;
  state.collectionSession.collectionId = msg.collectionId;
  state.collectionSession.batchSlug = msg.batchSlug;
  uploadFiles(msg.collectionId, msg.batchSlug);
}

async function uploadFiles(collectionId, batchSlug) {
  send({ type: 'upload_batch_start', collectionId, batchSlug });

  const fill = document.getElementById('collection-progress-fill');
  const num = document.getElementById('collection-progress-num');
  const total = selectedFiles.length;

  for (let i = 0; i < total; i++) {
    const file = selectedFiles[i];
    const data = await fileToBase64(file);
    send({ type: 'upload_batch_file', collectionId, batchSlug, fileIndex: i, filename: file.name, data });
    if (num) num.textContent = i + 1;
    if (fill) fill.style.width = `${((i + 1) / total * 25)}%`;
  }

  send({ type: 'upload_batch_complete', collectionId, batchSlug, totalFiles: total });
}

function fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  });
}

// --- Progress handlers ---

export function handleProgress(msg) {
  const label = document.getElementById('collection-phase-label');
  const num = document.getElementById('collection-progress-num');
  const denom = document.getElementById('collection-progress-denom');
  const fill = document.getElementById('collection-progress-fill');
  if (!label) return;

  const labels = { transcribing: 'Transcribing files...', assembling: 'Assembling content...', synthesizing: 'Synthesizing into KB...' };
  label.textContent = labels[msg.phase] || msg.phase;
  if (msg.currentFile != null) num.textContent = msg.currentFile;
  if (msg.totalFiles) denom.textContent = `of ${msg.totalFiles} files`;

  if (msg.phase === 'transcribing' && msg.totalFiles) fill.style.width = `${25 + (msg.currentFile / msg.totalFiles * 45)}%`;
  else if (msg.phase === 'assembling') fill.style.width = '75%';
  else if (msg.phase === 'synthesizing') fill.style.width = '88%';
}

export function handleFileProcessed(msg) {
  const preview = document.getElementById('collection-transcript-preview');
  if (preview && msg.snippet) {
    preview.classList.remove('hidden');
    preview.textContent = msg.snippet.slice(0, 160);
  }
}

export function handleSynthesisUpdate(msg) {
  const feed = document.getElementById('collection-synthesis-feed');
  if (!feed) return;
  feed.classList.remove('hidden');
  if (state.collectionSession) state.collectionSession.synthesisUpdates = (state.collectionSession.synthesisUpdates || 0) + 1;

  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = `<span class="feed-action">${escapeHtml(msg.action)}</span> <span class="feed-path">${escapeHtml(msg.filePath)}</span>`;
  feed.prepend(item);
  if (feed.children.length > 20) feed.lastChild.remove();
}

export function handleComplete(msg) {
  const fill = document.getElementById('collection-progress-fill');
  if (fill) fill.style.width = '100%';

  setTimeout(() => {
    goToStep(3);
    const stat = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    stat('collection-stat-files', msg.filesProcessed || state.collectionSession?.totalFiles || 0);
    stat('collection-stat-synthesis', state.collectionSession?.synthesisUpdates || 0);
  }, 600);
}

export function handleToolActivity(msg) {
  const el = document.getElementById('collection-activity');
  if (!el) return;
  el.classList.remove('hidden');
  const labels = { Read: 'Reading', Write: 'Writing', Glob: 'Scanning', Grep: 'Searching', Edit: 'Editing', Bash: 'Running' };
  const label = labels[msg.tool] || msg.tool;
  const detail = msg.detail ? msg.detail.replace(/^.*\//, '') : '';
  el.innerHTML = `<span class="pulse-dot-small"></span> <span class="collection-activity-label">${escapeHtml(label)}</span> <span class="collection-activity-detail">${escapeHtml(detail)}</span>`;
}

export function handleError(msg) {
  const container = document.getElementById('collection-container');
  if (!container) return;
  const existing = container.querySelector('.collection-error');
  if (existing) existing.remove();
  const err = document.createElement('div');
  err.className = 'collection-error';
  err.textContent = msg.message || 'An error occurred';
  container.appendChild(err);
}
