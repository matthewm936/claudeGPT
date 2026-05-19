import { state, dom } from './state.js';
import { send } from './ws.js';
import { escapeHtml, scrollToBottom } from './utils.js';

const CATEGORY_ICONS = { journal: '\u{1F4D3}', person: '\u{1F464}', creative: '\u{1F3A8}', dream: '\u{1F311}', reflection: '\u{1FA9E}', goal: '\u{1F3AF}', decision: '\u{2696}', project: '\u{1F527}', philosophy: '\u{1F4A1}', technical: '\u{1F4BB}', research: '\u{1F50D}', skip: '\u{23E9}', other: '\u{1F4C4}' };

let autoIngestTimer = null;
let autoIngestCountdown = 5;
let triageComplete = false;
let discoveryTransitioned = false;
let discoveryShownAt = 0;
let pendingReadings = [];
let itemRenderQueue = [];
let itemRenderTimer = null;
const DISCOVERY_MIN_MS = 4000; // minimum time to show the discovery phase
const ITEM_STAGGER_MS = 80; // delay between rendering each feed item

export function resumeFromCheckpoint(msg) {
  // Restore client state from checkpoint
  state.triageTotal = msg.totalConversations || 0;
  state.triageSummarized = state.triageTotal;
  state.triageItems = msg.triageItems || [];
  state.triageDecisions = msg.decisions || {};
  state.triageAskItems = msg.askItems || {};
  triageComplete = true;
  discoveryTransitioned = true;

  // Jump to step 3 and show classify phase directly
  switchStep(3);

  // Hide discovery, show classify
  const discovery = document.getElementById('triage-discovery');
  const classify = document.getElementById('triage-classify');
  if (discovery) discovery.classList.add('hidden');
  if (classify) {
    classify.classList.remove('hidden');
    setupFilterListeners();
  }

  // Render all triage items immediately
  for (const item of state.triageItems) {
    renderTriageItem(item);
  }

  // Update header to show "Resumed" state
  const dot = document.getElementById('classify-dot');
  if (dot) { dot.classList.remove('pulse-dot'); dot.classList.add('done-check'); dot.textContent = '\u2713'; }
  const status = document.getElementById('classify-status');
  if (status) status.textContent = 'Resumed from checkpoint';
  const progressEl = document.getElementById('classify-progress');
  if (progressEl) progressEl.textContent = `${state.triageTotal} of ${state.triageTotal}`;

  // Reveal filters
  const filters = document.getElementById('triage-filters');
  if (filters) { filters.classList.remove('hidden'); filters.classList.add('filters-revealed'); }

  updateLiveCounts();
  checkAutoIngest();
}

export function showOnboarding() {
  state.onboardingRequired = true;
  const overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.innerHTML = `<div id="onboarding-container">
    <div id="onboarding-steps"><div class="step-indicator">
      <span class="step active current" data-step="1">1</span><span class="step-line"></span>
      <span class="step" data-step="2">2</span><span class="step-line"></span>
      <span class="step" data-step="3">3</span><span class="step-line"></span>
      <span class="step" data-step="4">4</span>
    </div></div>
    <div id="onboarding-content">
      <div id="step-1" class="onboarding-step active">
        <h1>Import your ChatGPT history</h1>
        <p class="onboarding-subtitle">YourPsyche builds a knowledge base about you from your conversations. The fastest way to start is importing your ChatGPT export.</p>
        <div class="instruction-video"><video controls preload="metadata"><source src="/chatgpt-export-tutorial.mp4" type="video/mp4"></video></div>
        <div class="instruction-steps">
          <div class="instruction-step"><span class="instruction-number">1</span><div><strong>Open ChatGPT Settings</strong><p>Go to chatgpt.com, click your profile icon, then Settings</p></div></div>
          <div class="instruction-step"><span class="instruction-number">2</span><div><strong>Request your data</strong><p>Data Controls &rarr; Export Data &rarr; Confirm export</p></div></div>
          <div class="instruction-step"><span class="instruction-number">3</span><div><strong>Wait for the email</strong><p>OpenAI sends a download link within minutes to hours</p></div></div>
          <div class="instruction-step"><span class="instruction-number">4</span><div><strong>Download the zip</strong><p>Click the link in the email to download your export zip file</p></div></div>
        </div>
        <div class="onboarding-actions">
          <button id="onboarding-next" class="onboarding-btn primary">I have my export</button>
          <button id="onboarding-skip" class="onboarding-btn secondary">Skip for now</button>
        </div>
      </div>
      <div id="step-2" class="onboarding-step">
        <h1>Drop your export</h1>
        <p class="onboarding-subtitle">Drag your ChatGPT export zip file here, or click to browse.</p>
        <div id="onboarding-dropzone"><div class="dropzone-content"><div class="dropzone-icon">&#8681;</div><p>Drop your .zip file here</p><p class="dropzone-hint">or click to browse</p></div><input type="file" id="onboarding-file-input" accept=".zip" hidden></div>
        <div id="upload-status" class="hidden"><p id="upload-status-text">Reading file...</p></div>
        <div class="onboarding-actions"><button id="onboarding-back-1" class="onboarding-btn secondary">Back</button></div>
      </div>
      <div id="step-3" class="onboarding-step">
        <div id="triage-phase">
          <!-- Phase A: Discovery -->
          <div id="triage-discovery">
            <div class="discovery-number" id="discovery-number">0</div>
            <div class="discovery-label">conversations found</div>
            <p class="discovery-explain">We're reading through your history to find the conversations that reveal who you are &mdash; your reflections, relationships, creative work, goals, and patterns. Everything else gets left behind.</p>
            <div class="discovery-status"><span class="pulse-dot"></span> <span id="discovery-status-text">Reading...</span></div>
          </div>

          <!-- Phase B+C: Classification + Review -->
          <div id="triage-classify" class="hidden">
            <div id="triage-header">
              <div class="triage-header-left">
                <span class="pulse-dot" id="classify-dot"></span>
                <span id="classify-status">Reading your history...</span>
              </div>
              <span class="triage-progress" id="classify-progress">0 of 0</span>
            </div>
            <div id="triage-live-counts">
              <span class="live-count keep" id="lc-keep">0</span>
              <span class="live-count-label">keeping</span>
              <span class="live-count-dot">&middot;</span>
              <span class="live-count skip" id="lc-skip">0</span>
              <span class="live-count-label">skipping</span>
              <span class="live-count-dot">&middot;</span>
              <span class="live-count ask" id="lc-ask">0</span>
              <span class="live-count-label">need input</span>
            </div>
            <div id="triage-filters" class="hidden">
              <button class="triage-filter active" data-filter="all">All</button>
              <button class="triage-filter" data-filter="keep">Keeping</button>
              <button class="triage-filter" data-filter="skip">Skipping</button>
              <button class="triage-filter" data-filter="ask">Need input</button>
            </div>
            <div id="triage-layout">
              <div id="triage-feed"><div id="triage-items"></div></div>
              <div id="conversation-preview" class="hidden">
                <div class="preview-header">
                  <span class="preview-title" id="preview-title"></span>
                  <button class="preview-close" id="preview-close">&times;</button>
                </div>
                <div class="preview-content" id="preview-content"></div>
              </div>
            </div>
            <div id="triage-actions">
              <div id="auto-ingest-notice" class="hidden">
                <span id="auto-ingest-text">Starting in 5s...</span>
                <button id="auto-ingest-cancel" class="onboarding-btn secondary">Review first</button>
              </div>
              <button id="triage-ingest-btn" class="onboarding-btn primary" disabled>Waiting for AI...</button>
            </div>
          </div>
        </div>
        <div id="ingest-phase" class="hidden">
          <h1>Building your knowledge base</h1>
          <p class="onboarding-subtitle">Processing your curated conversations into structured knowledge.</p>
          <div id="processing-stats" class="hidden"><div class="stat"><span class="stat-value" id="stat-total">0</span><span class="stat-label">conversations</span></div><div class="stat"><span class="stat-value" id="stat-substantive">0</span><span class="stat-label">data size</span></div></div>
          <div id="progress-bar"><div id="progress-fill"></div></div>
          <p id="progress-text">Starting ingestion...</p>
          <div id="ingest-activity" class="hidden"></div>
          <div class="live-construction">
            <div class="live-tree" id="live-tree"></div>
            <div class="live-feed" id="live-feed"></div>
            <div class="live-preview hidden" id="live-preview">
              <div class="live-preview-header"><span class="live-preview-path" id="live-preview-path"></span><button class="live-preview-close" id="live-preview-close">&times;</button></div>
              <div class="live-preview-content" id="live-preview-content"></div>
            </div>
          </div>
        </div>
      </div>
      <div id="step-4" class="onboarding-step">
        <h1>You have a knowledge base</h1>
        <p class="onboarding-subtitle">Claude read through your history and built a structured map of your life. Every conversation builds on everything that came before.</p>
        <div class="completion-stats" id="completion-stats"></div>
        <div class="onboarding-actions"><button id="onboarding-finish" class="onboarding-btn primary">Start talking</button></div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  setupOnboardingListeners();
  document.getElementById('live-preview-close').addEventListener('click', closeLivePreview);
}

function setupOnboardingListeners() {
  document.getElementById('onboarding-next').addEventListener('click', () => switchStep(2));
  document.getElementById('onboarding-skip').addEventListener('click', () => send({ type: 'skip_onboarding' }));
  document.getElementById('onboarding-back-1').addEventListener('click', () => switchStep(1));

  const dropzone = document.getElementById('onboarding-dropzone');
  const fileInput = document.getElementById('onboarding-file-input');
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleExportFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleExportFile(fileInput.files[0]); });

  document.getElementById('triage-ingest-btn').addEventListener('click', startIngestion);
  document.getElementById('preview-close').addEventListener('click', closeConversationPreview);
  document.getElementById('auto-ingest-cancel').addEventListener('click', cancelAutoIngest);
}

function handleExportFile(file) {
  if (!file.name.endsWith('.zip')) { showError('Please upload a .zip file'); return; }
  const status = document.getElementById('upload-status');
  const statusText = document.getElementById('upload-status-text');
  status.classList.remove('hidden');
  statusText.textContent = `Reading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`;

  const reader = new FileReader();
  reader.onload = () => { statusText.textContent = 'Uploading...'; send({ type: 'upload_chatgpt_export', data: reader.result.split(',')[1] }); switchStep(3); };
  reader.onerror = () => { statusText.textContent = 'Failed to read file. Try again.'; };
  reader.readAsDataURL(file);
}

function switchStep(n) {
  document.querySelectorAll('.onboarding-step').forEach(el => el.classList.remove('active'));
  document.getElementById(`step-${n}`).classList.add('active');
  document.querySelectorAll('.step-indicator .step').forEach(el => {
    const num = parseInt(el.dataset.step);
    el.classList.toggle('active', num <= n);
    el.classList.toggle('current', num === n);
  });
  const container = document.getElementById('onboarding-container');
  container.classList.toggle('wide', n === 3);
}

// --- Phase A: Discovery ---

function animateNumber(el, target, duration = 1000) {
  const start = performance.now();
  const from = 0;
  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (target - from) * eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

export function updateParsed(msg) {
  state.triageTotal = msg.totalConversations || msg.totalFiles || 0;
  state.triageSummarized = 0;
  state.triageItems = [];
  state.triageDecisions = {};
  state.triageAskItems = {};
  discoveryTransitioned = false;
  triageComplete = false;

  pendingReadings = [];
  discoveryShownAt = performance.now();

  // Show discovery phase, hide classify
  const discovery = document.getElementById('triage-discovery');
  const classify = document.getElementById('triage-classify');
  if (discovery) discovery.classList.remove('hidden');
  if (classify) classify.classList.add('hidden');

  // Animate the big number (slow enough to read)
  const numEl = document.getElementById('discovery-number');
  if (numEl) animateNumber(numEl, state.triageTotal, 2200);

  // Set up classify progress
  const progressEl = document.getElementById('classify-progress');
  if (progressEl) progressEl.textContent = `0 of ${state.triageTotal}`;
}

// --- Phase A → B transition ---

function transitionToClassify() {
  if (discoveryTransitioned) return;
  discoveryTransitioned = true;

  const discovery = document.getElementById('triage-discovery');
  const classify = document.getElementById('triage-classify');

  if (discovery) {
    discovery.classList.add('fading-out');
    setTimeout(() => {
      discovery.classList.add('hidden');
      discovery.classList.remove('fading-out');
    }, 400);
  }

  if (classify) {
    setTimeout(() => {
      classify.classList.remove('hidden');
      classify.classList.add('fading-in');
      // Attach filter listeners now that element is visible
      setupFilterListeners();
      setTimeout(() => classify.classList.remove('fading-in'), 400);
    }, 300);
  }
}

function setupFilterListeners() {
  document.querySelectorAll('#triage-filters .triage-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#triage-filters .triage-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterTriageItems(btn.dataset.filter);
    });
  });
}

// --- Phase B: Classification ---

export function updateProgress(msg) {
  if (msg.phase === 'summarizing') {
    state.triageSummarized = msg.summarized || 0;
    const progressEl = document.getElementById('classify-progress');
    if (progressEl) progressEl.textContent = `${state.triageSummarized} of ${state.triageTotal}`;
  } else if (msg.phase === 'ingesting') {
    const done = msg.completedBatches || 0;
    const total = msg.totalBatches || 0;
    const files = msg.totalFilesCreated || 0;
    const pct = total ? Math.round((done / total) * 85) : 10;
    const fill = document.getElementById('progress-fill');
    const text = document.getElementById('progress-text');
    if (fill) fill.style.width = `${pct}%`;
    if (text) {
      if (done === 0 && total === 0) {
        text.textContent = 'Preparing conversations for ingestion...';
      } else if (done === 0) {
        text.textContent = `Reading through ${msg.totalConversations || total} conversations...`;
      } else if (done < total) {
        text.textContent = files > 0
          ? `Building your knowledge base... ${files} files created`
          : `Processing your conversations (${done} of ${total} groups done)`;
      } else {
        text.textContent = `${files} files created — finishing up...`;
      }
    }
  } else if (msg.phase === 'synthesizing') {
    const fill = document.getElementById('progress-fill');
    const text = document.getElementById('progress-text');
    if (fill) fill.style.width = '90%';
    if (text) text.textContent = 'Synthesizing everything into a profile of who you are...';
  }
}

function bumpCount(el) {
  el.classList.remove('count-bump');
  // Force reflow
  void el.offsetWidth;
  el.classList.add('count-bump');
}

function updateLiveCounts() {
  let keepCount = 0, skipCount = 0, askCount = 0;
  for (const d of Object.values(state.triageDecisions)) {
    if (d === 'keep') keepCount++;
    else if (d === 'skip') skipCount++;
  }
  for (const [, ask] of Object.entries(state.triageAskItems)) {
    if (!ask.resolved) askCount++;
  }

  const keepEl = document.getElementById('lc-keep');
  const skipEl = document.getElementById('lc-skip');
  const askEl = document.getElementById('lc-ask');

  if (keepEl) {
    const prev = parseInt(keepEl.textContent) || 0;
    keepEl.textContent = keepCount;
    if (keepCount !== prev) bumpCount(keepEl);
  }
  if (skipEl) {
    const prev = parseInt(skipEl.textContent) || 0;
    skipEl.textContent = skipCount;
    if (skipCount !== prev) bumpCount(skipEl);
  }
  if (askEl) {
    const prev = parseInt(askEl.textContent) || 0;
    askEl.textContent = askCount;
    if (askCount !== prev) bumpCount(askEl);
  }

  const btn = document.getElementById('triage-ingest-btn');
  if (btn) {
    if (triageComplete && keepCount > 0) {
      btn.disabled = false;
      btn.textContent = `Start ingestion (${keepCount} conversations)`;
    } else {
      btn.disabled = true;
      btn.textContent = 'Waiting for AI...';
    }
  }
}

// Show a conversation as "reading..." in the feed before AI decides
export function addTriageReading(item) {
  // Buffer readings until the discovery phase has had enough screen time
  const elapsed = performance.now() - discoveryShownAt;
  if (!discoveryTransitioned && elapsed < DISCOVERY_MIN_MS) {
    pendingReadings.push(item);
    // Schedule the flush for when the min time expires (only once)
    if (pendingReadings.length === 1) {
      setTimeout(() => flushPendingReadings(), DISCOVERY_MIN_MS - elapsed);
    }
    return;
  }

  if (!discoveryTransitioned) transitionToClassify();
  appendReadingItem(item);
}

function flushPendingReadings() {
  if (!discoveryTransitioned) transitionToClassify();
  for (const item of pendingReadings) appendReadingItem(item);
  pendingReadings = [];
}

function appendReadingItem(item) {
  const feed = document.getElementById('triage-items');
  if (!feed) return;

  // Don't add duplicate reading items
  if (feed.querySelector(`.triage-feed-item[data-id="${item.id}"]`)) return;

  const el = document.createElement('div');
  el.className = 'triage-feed-item reading';
  el.dataset.id = item.id;
  el.dataset.decision = 'reading';

  el.innerHTML = `
    <div class="feed-item-main">
      <span class="feed-item-icon"><span class="pulse-dot-small"></span></span>
      <div class="feed-item-body">
        <div class="feed-item-title">${escapeHtml(item.title)}</div>
        <div class="feed-item-summary reading-text">Reading...</div>
      </div>
      <span class="feed-item-date">${item.date || ''}</span>
    </div>`;

  feed.prepend(el);
}

export function addTriageItem(item) {
  // Store decision in client state immediately (even if render is queued)
  state.triageItems.push(item);
  if (item.decision === 'keep' || item.decision === 'skip') {
    state.triageDecisions[item.id] = item.decision;
  } else if (item.decision === 'ask') {
    state.triageAskItems[item.id] = { reason: item.reason || '', resolved: false };
  }

  // Queue for staggered rendering
  itemRenderQueue.push(item);
  if (!itemRenderTimer) drainRenderQueue();
}

function drainRenderQueue() {
  if (itemRenderQueue.length === 0) { itemRenderTimer = null; return; }

  // If discovery hasn't transitioned yet, wait
  if (!discoveryTransitioned) {
    const elapsed = performance.now() - discoveryShownAt;
    if (elapsed < DISCOVERY_MIN_MS) {
      itemRenderTimer = setTimeout(() => drainRenderQueue(), DISCOVERY_MIN_MS - elapsed + 50);
      return;
    }
    flushPendingReadings();
  }

  const item = itemRenderQueue.shift();
  renderTriageItem(item);
  updateLiveCounts();

  if (itemRenderQueue.length > 0) {
    itemRenderTimer = setTimeout(() => drainRenderQueue(), ITEM_STAGGER_MS);
  } else {
    itemRenderTimer = null;
  }
}

function renderTriageItem(item) {
  const feed = document.getElementById('triage-items');
  if (!feed) return;

  // Check if there's a "reading" placeholder for this item — update it in place
  const existing = feed.querySelector(`.triage-feed-item[data-id="${item.id}"]`);
  const icon = CATEGORY_ICONS[item.category] || CATEGORY_ICONS.other;

  if (existing) {
    existing.className = `triage-feed-item decision-${item.decision} decided`;
    existing.dataset.decision = item.decision;
    existing.dataset.category = item.category;
    renderDecidedItem(existing, item, icon);
    // Move decided item to the top so the user sees activity
    feed.prepend(existing);
  } else {
    const el = document.createElement('div');
    el.className = `triage-feed-item decision-${item.decision}`;
    el.dataset.id = item.id;
    el.dataset.decision = item.decision;
    el.dataset.category = item.category;
    renderDecidedItem(el, item, icon);
    feed.prepend(el);
  }

  // Apply active filter
  const activeFilter = document.querySelector('#triage-filters .triage-filter.active');
  if (activeFilter && activeFilter.dataset.filter !== 'all') {
    const el = feed.querySelector(`.triage-feed-item[data-id="${item.id}"]`);
    if (el) applyFilterToItem(el, activeFilter.dataset.filter);
  }
}

function renderDecidedItem(el, item, icon) {
  if (item.decision === 'ask') {
    el.innerHTML = `
      <div class="feed-item-main">
        <span class="feed-item-icon">${icon}</span>
        <div class="feed-item-body">
          <div class="feed-item-title">${escapeHtml(item.title)}</div>
          <div class="feed-item-summary">${escapeHtml(item.summary)}</div>
          <div class="feed-item-reason">${escapeHtml(item.reason || 'Ambiguous \u2014 could go either way')}</div>
        </div>
        <span class="feed-item-date">${item.date || ''}</span>
      </div>
      <div class="feed-item-ask-actions">
        <button class="ask-btn keep-btn" data-id="${item.id}">Keep</button>
        <button class="ask-btn skip-btn" data-id="${item.id}">Skip</button>
        <button class="ask-btn view-btn" data-id="${item.id}">View</button>
      </div>`;
    el.querySelector('.keep-btn').addEventListener('click', (e) => { e.stopPropagation(); resolveAsk(item.id, 'keep'); });
    el.querySelector('.skip-btn').addEventListener('click', (e) => { e.stopPropagation(); resolveAsk(item.id, 'skip'); });
    el.querySelector('.view-btn').addEventListener('click', (e) => { e.stopPropagation(); openConversationPreview(item.id); });
  } else {
    const decisionLabel = item.decision === 'keep' ? 'keeping' : 'skipping';
    el.innerHTML = `
      <div class="feed-item-main">
        <span class="feed-item-icon">${icon}</span>
        <div class="feed-item-body">
          <div class="feed-item-title">${escapeHtml(item.title)}</div>
          <div class="feed-item-summary"><span class="decision-label decision-label-${item.decision}">${decisionLabel}</span> ${escapeHtml(item.summary)}</div>
        </div>
        <span class="feed-item-date">${item.date || ''}</span>
      </div>
      <div class="feed-item-hover-actions">
        <button class="hover-btn toggle-btn" data-id="${item.id}">${item.decision === 'keep' ? 'skip' : 'keep'}</button>
        <button class="hover-btn view-btn" data-id="${item.id}">view</button>
      </div>`;
    el.querySelector('.toggle-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleDecision(item.id); });
    el.querySelector('.view-btn').addEventListener('click', (e) => { e.stopPropagation(); openConversationPreview(item.id); });
  }
}

function toggleDecision(id) {
  const current = state.triageDecisions[id];
  const newDecision = current === 'keep' ? 'skip' : 'keep';
  state.triageDecisions[id] = newDecision;
  send({ type: 'triage_override', id, decision: newDecision });

  const el = document.querySelector(`.triage-feed-item[data-id="${id}"]`);
  if (el) {
    el.classList.remove('decision-keep', 'decision-skip');
    el.classList.add(`decision-${newDecision}`);
    el.dataset.decision = newDecision;
    const toggleBtn = el.querySelector('.toggle-btn');
    if (toggleBtn) toggleBtn.textContent = newDecision === 'keep' ? 'skip' : 'keep';
  }
  updateLiveCounts();
}

function resolveAsk(id, decision) {
  state.triageDecisions[id] = decision;
  if (state.triageAskItems[id]) state.triageAskItems[id].resolved = true;
  send({ type: 'triage_override', id, decision });

  const el = document.querySelector(`.triage-feed-item[data-id="${id}"]`);
  if (el) {
    el.classList.remove('decision-ask');
    el.classList.add(`decision-${decision}`, 'ask-resolved');
    el.dataset.decision = decision;
    const askActions = el.querySelector('.feed-item-ask-actions');
    if (askActions) {
      askActions.outerHTML = `<div class="feed-item-hover-actions">
        <button class="hover-btn toggle-btn" data-id="${id}">${decision === 'keep' ? 'skip' : 'keep'}</button>
        <button class="hover-btn view-btn" data-id="${id}">view</button>
      </div>`;
      el.querySelector('.toggle-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleDecision(id); });
      el.querySelector('.view-btn').addEventListener('click', (e) => { e.stopPropagation(); openConversationPreview(id); });
    }
    const reason = el.querySelector('.feed-item-reason');
    if (reason) reason.remove();
  }
  updateLiveCounts();
  checkAutoIngest();
}

function openConversationPreview(id) {
  send({ type: 'read_conversation', id });
  const preview = document.getElementById('conversation-preview');
  const previewTitle = document.getElementById('preview-title');
  const previewContent = document.getElementById('preview-content');
  if (preview) {
    preview.classList.remove('hidden');
    if (previewTitle) {
      const item = state.triageItems.find(i => i.id === id);
      previewTitle.textContent = item ? item.title : 'Loading...';
    }
    if (previewContent) previewContent.innerHTML = '<p style="color:var(--text-muted)">Loading conversation...</p>';
  }
}

export function showConversationText(msg) {
  const previewTitle = document.getElementById('preview-title');
  const previewContent = document.getElementById('preview-content');
  if (previewTitle) previewTitle.textContent = msg.title || 'Conversation';

  if (previewContent) {
    const text = msg.fullText || msg.userText || '';
    const rendered = text.split('\n').map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('User:') || trimmed.startsWith('Human:')) {
        return `<div class="conv-message conv-user"><strong>You:</strong> ${escapeHtml(trimmed.replace(/^(User|Human):\s*/, ''))}</div>`;
      } else if (trimmed.startsWith('Assistant:') || trimmed.startsWith('ChatGPT:')) {
        return `<div class="conv-message conv-assistant"><strong>ChatGPT:</strong> ${escapeHtml(trimmed.replace(/^(Assistant|ChatGPT):\s*/, ''))}</div>`;
      }
      return `<div class="conv-line">${escapeHtml(trimmed)}</div>`;
    }).filter(Boolean).join('\n');
    previewContent.innerHTML = rendered || '<p style="color:var(--text-muted)">No content available</p>';
  }
}

function closeConversationPreview() {
  const preview = document.getElementById('conversation-preview');
  if (preview) preview.classList.add('hidden');
}

function filterTriageItems(filter) {
  document.querySelectorAll('.triage-feed-item').forEach(el => {
    applyFilterToItem(el, filter);
  });
}

function applyFilterToItem(el, filter) {
  if (filter === 'all') {
    el.classList.remove('filtered');
  } else {
    el.classList.toggle('filtered', el.dataset.decision !== filter);
  }
}

// --- Phase C: Review ---

export function onTriageComplete() {
  updateLiveCounts();

  // Swap pulse dot for checkmark
  const dot = document.getElementById('classify-dot');
  if (dot) { dot.classList.remove('pulse-dot'); dot.classList.add('done-check'); dot.textContent = '\u2713'; }

  // Update status text
  const status = document.getElementById('classify-status');
  if (status) status.textContent = 'Done';

  // Update progress to show complete
  const progressEl = document.getElementById('classify-progress');
  if (progressEl) progressEl.textContent = `${state.triageTotal} of ${state.triageTotal}`;

  // Reveal filters
  const filters = document.getElementById('triage-filters');
  if (filters) {
    filters.classList.remove('hidden');
    filters.classList.add('filters-revealed');
  }

  triageComplete = true;
  checkAutoIngest();
}

export function onTriageReady() {
  checkAutoIngest();
}

function checkAutoIngest() {
  // Only start countdown after ALL conversations are classified
  if (!triageComplete) return;

  const hasUnresolved = Object.values(state.triageAskItems).some(a => !a.resolved);
  if (hasUnresolved) return;

  const keepCount = Object.values(state.triageDecisions).filter(d => d === 'keep').length;
  if (keepCount === 0) return;

  startAutoIngestCountdown();
}

function startAutoIngestCountdown() {
  cancelAutoIngest();
  autoIngestCountdown = 5;
  const notice = document.getElementById('auto-ingest-notice');
  const text = document.getElementById('auto-ingest-text');
  if (notice) notice.classList.remove('hidden');

  autoIngestTimer = setInterval(() => {
    autoIngestCountdown--;
    if (text) text.textContent = `Starting in ${autoIngestCountdown}s...`;
    if (autoIngestCountdown <= 0) {
      cancelAutoIngest();
      startIngestion();
    }
  }, 1000);
}

function cancelAutoIngest() {
  if (autoIngestTimer) {
    clearInterval(autoIngestTimer);
    autoIngestTimer = null;
  }
  const notice = document.getElementById('auto-ingest-notice');
  if (notice) notice.classList.add('hidden');
}

function startIngestion() {
  cancelAutoIngest();
  document.getElementById('triage-phase').classList.add('hidden');
  document.getElementById('ingest-phase').classList.remove('hidden');
  const keepCount = Object.values(state.triageDecisions).filter(d => d === 'keep').length;
  document.getElementById('stat-total').textContent = keepCount;
  document.getElementById('processing-stats').classList.remove('hidden');

  // Warn on accidental navigation during ingestion
  window.onbeforeunload = (e) => { e.preventDefault(); return ''; };
  send({ type: 'start_ingest' });
}

// --- Live construction (ingest phase) ---

function openLivePreview(filePath) {
  // Server's read_file prepends the profile dir, so strip user/ prefix
  const serverPath = filePath.replace(/^user\//, '');
  send({ type: 'read_file', path: serverPath });
  const preview = document.getElementById('live-preview');
  const feed = document.getElementById('live-feed');
  if (preview && feed) {
    feed.classList.add('hidden');
    preview.classList.remove('hidden');
    document.getElementById('live-preview-path').textContent = humanizeSlug(filePath.split('/').pop());
    document.getElementById('live-preview-content').innerHTML = '<p style="color:var(--text-muted)">Loading...</p>';
  }
}

function closeLivePreview() {
  const preview = document.getElementById('live-preview');
  const feed = document.getElementById('live-feed');
  if (preview && feed) { preview.classList.add('hidden'); feed.classList.remove('hidden'); }
}

export function addToolActivity(msg) {
  const activityEl = document.getElementById('ingest-activity');
  if (!activityEl) return;

  const toolLabels = { Read: 'Reading', Glob: 'Scanning', Grep: 'Searching', Bash: 'Running' };
  const label = toolLabels[msg.tool] || msg.tool;
  const detail = msg.detail ? msg.detail.replace(/^.*\//, '') : '';

  activityEl.innerHTML = `<span class="pulse-dot-small"></span> <span class="activity-label">${escapeHtml(label)}</span> <span class="activity-detail">${escapeHtml(detail)}</span>`;
  activityEl.classList.remove('hidden');
}

function humanizeSlug(filename) {
  return filename
    .replace(/\.md$/, '')
    .replace(/^\d{4}-\d{2}-\d{2}-?/, '') // strip date prefix
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim() || filename;
}

function humanizeDirName(dir) {
  const labels = {
    user: 'Knowledge Base', record: 'Record', understanding: 'Understanding',
    world: 'World', active: 'Active', journal: 'Journal', moments: 'Moments',
    dreams: 'Dreams', creative: 'Creative', people: 'People', projects: 'Projects',
    influences: 'Influences', worldview: 'Worldview', patterns: 'Patterns',
    insights: 'Insights', goals: 'Goals', decisions: 'Decisions', poetry: 'Poetry',
    writing: 'Writing', idols: 'Idols', media: 'Media', systems: 'Systems',
    profiles: 'Profiles',
  };
  return labels[dir] || dir.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function ensureTreeDir(treeEl, dirPath, depth) {
  let container = treeEl.querySelector(`.tree-dir[data-path="${CSS.escape(dirPath)}"]`);
  if (container) return container;

  // Ensure parent exists first
  const parts = dirPath.split('/');
  let parent = treeEl;
  if (parts.length > 1) {
    const parentPath = parts.slice(0, -1).join('/');
    parent = ensureTreeDir(treeEl, parentPath, depth - 1);
  }

  // Create dir label + container
  const label = document.createElement('div');
  label.className = 'live-tree-item is-dir';
  label.style.paddingLeft = `${0.75 + (depth - 1) * 0.8}rem`;
  label.textContent = humanizeDirName(parts[parts.length - 1]);

  container = document.createElement('div');
  container.className = 'tree-dir';
  container.dataset.path = dirPath;
  container.appendChild(label);
  parent.appendChild(container);

  return container;
}

export function addLiveFileCreated(msg) {
  const treeEl = document.getElementById('live-tree');
  if (treeEl && !state.liveTreePaths.has(msg.filePath)) {
    state.liveTreePaths.add(msg.filePath);
    const parts = msg.filePath.split('/');
    const dirPath = parts.slice(0, -1).join('/');
    const depth = parts.length;

    // Ensure parent directory chain exists, then append file
    const parentContainer = dirPath ? ensureTreeDir(treeEl, dirPath, depth - 1) : treeEl;

    const fileItem = document.createElement('div');
    fileItem.className = 'live-tree-item is-file';
    fileItem.style.paddingLeft = `${0.75 + (depth - 1) * 0.8}rem`;
    fileItem.textContent = humanizeSlug(parts[parts.length - 1]);
    fileItem.addEventListener('click', () => openLivePreview(msg.filePath));
    parentContainer.appendChild(fileItem);
    treeEl.scrollTop = treeEl.scrollHeight;
  }

  const feedEl = document.getElementById('live-feed');
  if (feedEl) {
    const item = document.createElement('div');
    item.className = 'feed-item';
    const cleanSnippet = msg.snippet ? msg.snippet.replace(/^---[\s\S]*?---\n*/, '').trim() : '';
    const snippet = cleanSnippet ? `<div class="feed-snippet">${marked.parse(cleanSnippet)}</div>` : '';
    const displayName = humanizeSlug(msg.filePath.split('/').pop());
    item.innerHTML = `<div class="feed-item-header"><span class="feed-action ${msg.action === 'updated' ? 'updated' : ''}">${msg.action}</span><span class="feed-path" data-path="${escapeHtml(msg.filePath)}">${escapeHtml(displayName)}</span></div>${snippet}`;
    item.querySelector('.feed-path').addEventListener('click', () => openLivePreview(msg.filePath));
    feedEl.insertBefore(item, feedEl.firstChild);
    while (feedEl.children.length > 50) feedEl.removeChild(feedEl.lastChild);
  }
}

export function showComplete(msg) {
  window.onbeforeunload = null;  // Clear nav warning
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = '100%';
  closeLivePreview();

  const stats = { journal: 0, people: 0, patterns: 0, goals: 0, creative: 0, total: 0 };
  for (const p of state.liveTreePaths) {
    if (p.includes('/')) stats.total++;
    if (p.includes('record/journal/')) stats.journal++;
    if (p.includes('world/people/')) stats.people++;
    if (p.includes('understanding/patterns/')) stats.patterns++;
    if (p.includes('active/goals/')) stats.goals++;
    if (p.includes('record/creative/')) stats.creative++;
  }
  if (msg.filesProcessed && msg.filesProcessed > stats.total) stats.total = msg.filesProcessed;

  const statsEl = document.getElementById('completion-stats');
  const items = [
    msg.conversationsIngested ? { label: 'Conversations ingested', value: msg.conversationsIngested } : null,
    { label: 'Journal entries', value: stats.journal },
    { label: 'People', value: stats.people },
    { label: 'Patterns', value: stats.patterns },
    { label: 'Goals', value: stats.goals },
    { label: 'Creative works', value: stats.creative },
    { label: 'Total KB files', value: stats.total },
  ].filter(s => s && s.value > 0);

  statsEl.innerHTML = items.map(s => `<div class="completion-stat"><span class="stat-value">${s.value}</span><span class="stat-label">${s.label}</span></div>`).join('');
  switchStep(4);

  document.getElementById('onboarding-finish').addEventListener('click', () => {
    hideOnboarding();
    send({ type: 'list_conversations' });
    send({ type: 'file_tree' });
  });
}

export function showError(message) {
  const existing = document.querySelector('.onboarding-error');
  if (existing) existing.remove();
  const err = document.createElement('div');
  err.className = 'onboarding-error';
  err.textContent = message;
  const activeStep = document.querySelector('.onboarding-step.active');
  if (activeStep) activeStep.appendChild(err);
}

export function hideOnboarding() {
  state.onboardingRequired = false;
  const overlay = document.getElementById('onboarding-overlay');
  if (overlay) { overlay.classList.add('fading'); setTimeout(() => overlay.remove(), 400); }
}
