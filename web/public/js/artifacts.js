/**
 * Artifact ingestion wizard — multi-step UI for uploading
 * and processing physical journal pages.
 */

import { state } from './state.js';
import { send } from './ws.js';
import { escapeHtml } from './utils.js';

let currentStep = 1;
let selectedFiles = [];
let overlay = null;

const IMAGE_EXTS = /\.(jpg|jpeg|png|heic|webp)$/i;

// --- Wizard lifecycle ---

export function showArtifactWizard() {
  if (document.getElementById('artifact-overlay')) {
    document.getElementById('artifact-overlay').classList.remove('hidden');
    return;
  }
  overlay = createOverlay();
  document.body.appendChild(overlay);
  goToStep(1);
}

export function hideArtifactWizard() {
  const el = document.getElementById('artifact-overlay');
  if (el) { el.classList.add('fading'); setTimeout(() => el.remove(), 400); }
  overlay = null;
  currentStep = 1;
  selectedFiles = [];
  state.artifactSession = null;
}

// --- DOM creation ---

function createOverlay() {
  const div = document.createElement('div');
  div.id = 'artifact-overlay';
  div.innerHTML = `
    <div id="artifact-container">
      <div class="artifact-steps">
        <div class="artifact-step-dot active current" data-step="1">1</div>
        <div class="artifact-step-line"></div>
        <div class="artifact-step-dot" data-step="2">2</div>
        <div class="artifact-step-line"></div>
        <div class="artifact-step-dot" data-step="3">3</div>
        <div class="artifact-step-line"></div>
        <div class="artifact-step-dot" data-step="4">4</div>
      </div>

      <!-- Step 1: Drop images -->
      <div class="artifact-step active" id="artifact-step-1">
        <h1>Digitize a notebook</h1>
        <p class="artifact-subtitle">Drop a folder of page photos (or select files). Photos should be in reading order — name them sequentially.</p>
        <div id="artifact-dropzone">
          <div class="artifact-dropzone-icon">&#128214;</div>
          <p>Drop page images here</p>
          <p class="artifact-dropzone-hint">JPG, PNG, HEIC, WebP</p>
          <input type="file" id="artifact-file-input" multiple accept="image/*" style="display:none">
        </div>
        <div id="artifact-page-count" class="hidden"></div>
        <div id="artifact-thumbnails" class="hidden"></div>
        <div class="artifact-actions">
          <button class="artifact-btn primary" id="artifact-next-1" disabled>Next</button>
          <button class="artifact-btn secondary" id="artifact-cancel">Cancel</button>
        </div>
      </div>

      <!-- Step 2: Metadata -->
      <div class="artifact-step" id="artifact-step-2">
        <h1>About this notebook</h1>
        <p class="artifact-subtitle">Give some basic context. The AI handles the rest.</p>
        <div class="artifact-form">
          <div class="artifact-field">
            <label>Name</label>
            <input type="text" id="artifact-name" placeholder="Blue spiral notebook">
          </div>
          <div class="artifact-field">
            <label>Rough timeline</label>
            <input type="text" id="artifact-timeline" placeholder="Spring 2014, college years, last summer...">
            <span class="field-hint">As vague or specific as you want</span>
          </div>
          <div class="artifact-field">
            <label>What's in it?</label>
            <textarea id="artifact-description" placeholder="Daily journal entries, project ideas, poems..." rows="2"></textarea>
            <span class="field-hint">A sentence or two about the content type</span>
          </div>
          <div class="artifact-field">
            <label>Physical description</label>
            <input type="text" id="artifact-physical" placeholder="Black moleskin, ~80 pages, ink">
          </div>
          <div class="artifact-field">
            <label>Where were you in life?</label>
            <input type="text" id="artifact-life-stage" placeholder="Senior year of high school, living in Portland">
          </div>
          <div class="artifact-field">
            <label>Anything else the AI should know?</label>
            <textarea id="artifact-notes" placeholder="Context, corrections, things to look for..." rows="2"></textarea>
          </div>
        </div>
        <div class="artifact-actions">
          <button class="artifact-btn primary" id="artifact-start">Start processing</button>
          <button class="artifact-btn secondary" id="artifact-back-2">Back</button>
        </div>
      </div>

      <!-- Step 3: Processing -->
      <div class="artifact-step" id="artifact-step-3">
        <div class="artifact-progress-header">
          <div class="artifact-progress-phase"><span class="pulse-dot"></span> <span id="artifact-phase-label">Uploading pages...</span></div>
          <div class="artifact-progress-count" id="artifact-progress-num">0</div>
          <div class="artifact-progress-label" id="artifact-progress-denom">of 0 pages</div>
        </div>
        <div id="artifact-progress-bar"><div id="artifact-progress-fill"></div></div>
        <div id="artifact-activity" class="hidden"></div>
        <div id="artifact-anchor-dates" class="hidden"></div>
        <div id="artifact-transcript-preview" class="hidden"></div>
        <div id="artifact-filing-feed" class="hidden"></div>
      </div>

      <!-- Step 4: Complete -->
      <div class="artifact-step" id="artifact-step-4">
        <h1>Notebook digitized</h1>
        <div class="artifact-completion-stats">
          <div class="artifact-completion-stat"><span class="stat-value" id="artifact-stat-pages">0</span><span class="stat-label">Pages</span></div>
          <div class="artifact-completion-stat"><span class="stat-value" id="artifact-stat-dates">0</span><span class="stat-label">Dates found</span></div>
          <div class="artifact-completion-stat"><span class="stat-value" id="artifact-stat-files">0</span><span class="stat-label">KB files</span></div>
        </div>
        <div class="artifact-actions">
          <button class="artifact-btn primary" id="artifact-read-btn">Read your notebook</button>
          <button class="artifact-btn secondary" id="artifact-done-btn">Done</button>
        </div>
        <div id="artifact-review">
          <div class="artifact-review-header">
            <h2>Refine context</h2>
            <p class="artifact-subtitle">Now that you've seen the content, add anything you remember.</p>
          </div>
          <div class="artifact-form">
            <div class="artifact-field">
              <label>Name</label>
              <input type="text" id="artifact-review-name" disabled>
            </div>
            <div class="artifact-field">
              <label>Rough timeline</label>
              <input type="text" id="artifact-review-timeline" placeholder="Spring 2014, college years, last summer...">
            </div>
            <div class="artifact-field">
              <label>What's in it?</label>
              <textarea id="artifact-review-description" rows="2"></textarea>
            </div>
            <div class="artifact-field">
              <label>Physical description</label>
              <input type="text" id="artifact-review-physical" placeholder="Black moleskin, ~80 pages, ink">
            </div>
            <div class="artifact-field">
              <label>Where were you in life?</label>
              <textarea id="artifact-review-life-stage" placeholder="Now that you've read it, what do you remember about this period?" rows="2"></textarea>
            </div>
            <div class="artifact-field">
              <label>Anything else the AI should know?</label>
              <textarea id="artifact-review-notes" placeholder="Context, corrections, things the transcription might have missed..." rows="2"></textarea>
            </div>
          </div>
          <div class="artifact-actions">
            <button class="artifact-btn primary" id="artifact-save-review">Save & talk to AI</button>
            <span id="artifact-review-saved" class="review-saved hidden">Saved</span>
          </div>
        </div>
      </div>
    </div>`;

  // Event bindings
  const dz = div.querySelector('#artifact-dropzone');
  const fi = div.querySelector('#artifact-file-input');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
  fi.addEventListener('change', () => { if (fi.files.length) handleFiles(fi.files); });

  div.querySelector('#artifact-next-1').addEventListener('click', () => goToStep(2));
  div.querySelector('#artifact-cancel').addEventListener('click', hideArtifactWizard);
  div.querySelector('#artifact-back-2').addEventListener('click', () => goToStep(1));
  div.querySelector('#artifact-start').addEventListener('click', startUpload);
  div.querySelector('#artifact-done-btn').addEventListener('click', () => { hideArtifactWizard(); send({ type: 'list_artifacts' }); });
  div.querySelector('#artifact-read-btn').addEventListener('click', () => {
    if (state.artifactSession?.artifactId) send({ type: 'read_artifact', artifactId: state.artifactSession.artifactId });
    // Minimize wizard instead of closing — user can refine context after reading
    const el = document.getElementById('artifact-overlay');
    if (el) el.classList.add('hidden');
  });
  div.querySelector('#artifact-save-review').addEventListener('click', saveReviewMetadata);

  return div;
}

// --- Step navigation ---

function goToStep(n) {
  currentStep = n;
  const steps = overlay.querySelectorAll('.artifact-step');
  const dots = overlay.querySelectorAll('.artifact-step-dot');
  steps.forEach((s, i) => s.classList.toggle('active', i === n - 1));
  dots.forEach((d, i) => { d.classList.toggle('active', i < n); d.classList.toggle('current', i === n - 1); });
}

// --- File handling ---

function handleFiles(fileList) {
  selectedFiles = [...fileList].filter(f => IMAGE_EXTS.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (selectedFiles.length === 0) return;

  const thumbsEl = overlay.querySelector('#artifact-thumbnails');
  const countEl = overlay.querySelector('#artifact-page-count');
  thumbsEl.classList.remove('hidden');
  countEl.classList.remove('hidden');
  countEl.textContent = `${selectedFiles.length} pages`;
  thumbsEl.innerHTML = '';

  selectedFiles.forEach((file, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'artifact-thumb';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    const label = document.createElement('div');
    label.className = 'artifact-thumb-label';
    label.textContent = i + 1;
    thumb.append(img, label);
    thumbsEl.appendChild(thumb);
  });

  overlay.querySelector('#artifact-next-1').disabled = false;
}

// --- Upload + start processing ---

async function startUpload() {
  const name = overlay.querySelector('#artifact-name').value.trim();
  if (!name) { overlay.querySelector('#artifact-name').focus(); return; }

  goToStep(3);
  const phaseLabel = overlay.querySelector('#artifact-phase-label');
  const progressNum = overlay.querySelector('#artifact-progress-num');
  const progressDenom = overlay.querySelector('#artifact-progress-denom');
  phaseLabel.textContent = 'Uploading pages...';
  progressDenom.textContent = `of ${selectedFiles.length} pages`;

  const metadata = {
    name,
    description: overlay.querySelector('#artifact-description').value.trim(),
    timeline: overlay.querySelector('#artifact-timeline').value.trim(),
    physicalDescription: overlay.querySelector('#artifact-physical').value.trim(),
    lifeStage: overlay.querySelector('#artifact-life-stage').value.trim(),
    notes: overlay.querySelector('#artifact-notes').value.trim(),
  };

  send({ type: 'upload_artifact_start', metadata });

  // Wait for artifact_upload_started response before sending pages
  state.artifactSession = { metadata, totalPages: selectedFiles.length, filesCreated: 0 };
}

// Called from router when artifact_upload_started arrives
export function onUploadStarted(msg) {
  if (!state.artifactSession) return;
  state.artifactSession.artifactId = msg.artifactId;
  state.artifactSession.slug = msg.slug;
  uploadPages(msg.artifactId);
}

async function uploadPages(artifactId) {
  const progressNum = document.getElementById('artifact-progress-num');
  const fill = document.getElementById('artifact-progress-fill');
  const total = selectedFiles.length;

  for (let i = 0; i < total; i++) {
    const file = selectedFiles[i];
    const data = await fileToBase64(file);
    send({ type: 'upload_artifact_page', artifactId, pageNumber: i + 1, filename: file.name, data });
    if (progressNum) progressNum.textContent = i + 1;
    if (fill) fill.style.width = `${((i + 1) / total * 30)}%`; // upload = first 30%
  }

  send({ type: 'upload_artifact_complete', artifactId, totalPages: total });
}

function fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  });
}

// --- Progress updates (called from router) ---

export function handleProgress(msg) {
  const phaseLabel = document.getElementById('artifact-phase-label');
  const progressNum = document.getElementById('artifact-progress-num');
  const progressDenom = document.getElementById('artifact-progress-denom');
  const fill = document.getElementById('artifact-progress-fill');
  if (!phaseLabel) return;

  const labels = { transcribing: 'Transcribing pages...', assembling: 'Assembling notebook...', filing: 'Filing into KB...' };
  phaseLabel.textContent = labels[msg.phase] || msg.phase;
  if (msg.currentPage != null) progressNum.textContent = msg.currentPage;
  if (msg.totalPages) progressDenom.textContent = `of ${msg.totalPages} pages`;

  if (msg.phase === 'transcribing' && msg.totalPages) {
    fill.style.width = `${30 + (msg.currentPage / msg.totalPages * 50)}%`; // transcription = 30-80%
  } else if (msg.phase === 'assembling') {
    fill.style.width = '85%';
  } else if (msg.phase === 'filing') {
    fill.style.width = '92%';
  }
}

export function handlePageTranscribed(msg) {
  const preview = document.getElementById('artifact-transcript-preview');
  if (preview && msg.snippet) {
    preview.classList.remove('hidden');
    preview.textContent = `Page ${msg.page}: ${msg.snippet}`;
  }
  const progressNum = document.getElementById('artifact-progress-num');
  if (progressNum) progressNum.textContent = msg.page;
}

export function handleAnchorDate(msg) {
  const container = document.getElementById('artifact-anchor-dates');
  if (!container) return;
  container.classList.remove('hidden');
  const chip = document.createElement('span');
  chip.className = 'anchor-date-chip';
  chip.textContent = `p.${msg.page}: ${msg.date}`;
  container.appendChild(chip);
}

export function handleFileCreated(msg) {
  const feed = document.getElementById('artifact-filing-feed');
  if (!feed) return;
  feed.classList.remove('hidden');
  if (state.artifactSession) state.artifactSession.filesCreated = (state.artifactSession.filesCreated || 0) + 1;

  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = `<div class="feed-item-header"><span class="feed-action">${escapeHtml(msg.action)}</span><span class="feed-path">${escapeHtml(msg.filePath)}</span></div>${msg.snippet ? `<div class="feed-snippet">${escapeHtml(msg.snippet.slice(0, 120))}</div>` : ''}`;
  feed.prepend(item);
  if (feed.children.length > 30) feed.lastChild.remove();
}

export function handleComplete(msg) {
  const fill = document.getElementById('artifact-progress-fill');
  if (fill) fill.style.width = '100%';

  setTimeout(() => {
    goToStep(4);
    const stat = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    stat('artifact-stat-pages', msg.pagesTranscribed || 0);
    stat('artifact-stat-dates', msg.anchorDates?.length || 0);
    stat('artifact-stat-files', state.artifactSession?.filesCreated || 0);
    prefillReview();
  }, 600);
}

function prefillReview() {
  const meta = state.artifactSession?.metadata;
  if (!meta) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('artifact-review-name', meta.name);
  set('artifact-review-timeline', meta.timeline);
  set('artifact-review-description', meta.description);
  set('artifact-review-physical', meta.physicalDescription);
  set('artifact-review-life-stage', meta.lifeStage);
  set('artifact-review-notes', meta.notes);
}

function saveReviewMetadata() {
  if (!state.artifactSession?.artifactId) return;
  const meta = state.artifactSession?.metadata || {};
  const timeline = document.getElementById('artifact-review-timeline')?.value.trim() || '';
  const description = document.getElementById('artifact-review-description')?.value.trim() || '';
  const physicalDescription = document.getElementById('artifact-review-physical')?.value.trim() || '';
  const lifeStage = document.getElementById('artifact-review-life-stage')?.value.trim() || '';
  const reviewNotes = document.getElementById('artifact-review-notes')?.value.trim() || '';

  // Save updated metadata to manifest
  const updates = { timeline, description, physicalDescription, lifeStage, reviewNotes };
  send({ type: 'update_artifact_metadata', artifactId: state.artifactSession.artifactId, updates });

  // Build a chat message so the AI can process the notebook in context
  const parts = [`I just digitized a physical notebook: "${meta.name || 'untitled'}".`];
  if (timeline) parts.push(`Timeline: ${timeline}.`);
  if (description) parts.push(`Contents: ${description}.`);
  if (lifeStage) parts.push(`Where I was in life: ${lifeStage}.`);
  if (reviewNotes) parts.push(`Additional context: ${reviewNotes}.`);
  parts.push(`Read the full notebook at data/artifacts/notebooks/${state.artifactSession.slug}/full-text.md and tell me what you see — what patterns, what threads, what stands out. Then file anything important into my KB.`);

  // Close wizard, send as chat
  hideArtifactWizard();
  send({ type: 'list_artifacts' });

  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.value = parts.join(' ');
    chatInput.dispatchEvent(new Event('input'));
    chatInput.focus();
  }
}

export function handleToolActivity(msg) {
  const el = document.getElementById('artifact-activity');
  if (!el) return;
  el.classList.remove('hidden');

  const labels = { Read: 'Reading', Write: 'Writing', Glob: 'Scanning', Grep: 'Searching', Edit: 'Editing', Bash: 'Running' };
  const label = labels[msg.tool] || msg.tool;
  const detail = msg.detail ? msg.detail.replace(/^.*\//, '') : '';
  el.innerHTML = `<span class="pulse-dot-small"></span> <span class="artifact-activity-label">${escapeHtml(label)}</span> <span class="artifact-activity-detail">${escapeHtml(detail)}</span>`;
}

export function handleError(msg) {
  const container = document.getElementById('artifact-container');
  if (!container) return;
  const existing = container.querySelector('.artifact-error');
  if (existing) existing.remove();
  const err = document.createElement('div');
  err.className = 'artifact-error';
  err.textContent = msg.message || 'An error occurred';
  container.appendChild(err);
}
