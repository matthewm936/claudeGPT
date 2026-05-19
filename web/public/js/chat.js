import { state, dom } from './state.js';
import { send } from './ws.js';
import { escapeHtml, linkifyKbPaths, scrollToBottom } from './utils.js';

export function sendMessage() {
  const text = dom.chatInput.value.trim();
  if (!text || state.isStreaming) return;

  if (!state.currentConversationId) {
    const tempHandler = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'conversation') {
        state.ws.removeEventListener('message', tempHandler);
        state.currentConversationId = msg.data.id;
        sendChatMessage(text);
      }
    };
    state.ws.addEventListener('message', tempHandler);
    send({ type: 'new_conversation' });
    return;
  }

  sendChatMessage(text);
}

function sendChatMessage(text) {
  const guide = document.getElementById('welcome-guide');
  if (guide) guide.remove();
  const antSvg = document.getElementById('welcome-ant-svg');
  if (antSvg) antSvg.remove();
  appendMessage('user', text, false);
  send({ type: 'chat', conversationId: state.currentConversationId, text, model: state.selectedModel });
  dom.chatInput.value = '';
  dom.chatInput.style.height = 'auto';
  state.isStreaming = true;
  dom.sendBtn.disabled = true;
  state.streamBuffer = '';
  state.toolActions = [];

  const msgEl = createMessageElement('assistant', '');
  msgEl.classList.add('streaming');
  dom.messages.appendChild(msgEl);
  scrollToBottom();
}

export function handleStreamChunk(text) {
  state.streamBuffer += text;
  if (!state.renderTimer) {
    state.renderTimer = requestAnimationFrame(() => {
      const el = dom.messages.querySelector('.message.streaming .msg-content');
      if (el) el.innerHTML = linkifyKbPaths(marked.parse(state.streamBuffer));
      scrollToBottom();
      state.renderTimer = null;
    });
  }
}

export function handleStreamReset(cleanText) {
  state.streamBuffer = cleanText || '';
  const el = dom.messages.querySelector('.message.streaming .msg-content');
  if (el) el.innerHTML = state.streamBuffer ? linkifyKbPaths(marked.parse(state.streamBuffer)) : '';
}

export function addToolAction(tool, detail) {
  state.toolActions.push({ tool, detail });
  const streamingEl = dom.messages.querySelector('.message.streaming');
  if (!streamingEl) return;

  let logEl = streamingEl.querySelector('.tool-log');
  if (!logEl) { logEl = document.createElement('div'); logEl.className = 'tool-log'; streamingEl.appendChild(logEl); }

  const item = document.createElement('div');
  item.className = 'tool-log-item';
  const detailText = detail ? ` ${escapeHtml(detail)}` : '';
  item.innerHTML = `<span class="tool-action">${escapeHtml(tool)}</span>${detailText}`;
  logEl.appendChild(item);
  scrollToBottom();
}

export function finishStreaming(costUsd, finalText) {
  state.isStreaming = false;
  dom.sendBtn.disabled = false;

  const streamingEl = dom.messages.querySelector('.message.streaming');
  if (streamingEl) {
    const contentEl = streamingEl.querySelector('.msg-content');
    if (contentEl) contentEl.innerHTML = linkifyKbPaths(marked.parse(finalText || state.streamBuffer));

    const logEl = streamingEl.querySelector('.tool-log');
    if (logEl && state.toolActions.length > 0) {
      logEl.classList.add('collapsed');
      const header = document.createElement('div');
      header.className = 'tool-log-header';
      header.textContent = `${state.toolActions.length} action${state.toolActions.length === 1 ? '' : 's'}`;
      header.addEventListener('click', () => logEl.classList.toggle('collapsed'));
      logEl.prepend(header);
    }
    streamingEl.classList.remove('streaming');
  }

  state.streamBuffer = '';
  state.toolActions = [];
  scrollToBottom();
  dom.chatInput.focus();
}

export function appendMessage(role, content, scroll = true, tools) {
  const el = createMessageElement(role, content, tools);
  dom.messages.appendChild(el);
  if (scroll) scrollToBottom();
}

export function createMessageElement(role, content, tools) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  const rendered = content ? linkifyKbPaths(marked.parse(content)) : '';
  el.innerHTML = `<div class="msg-role">${role}</div><div class="msg-content">${rendered}</div>`;

  if (tools && tools.length > 0) {
    const logEl = document.createElement('div');
    logEl.className = 'tool-log collapsed';
    const header = document.createElement('div');
    header.className = 'tool-log-header';
    header.textContent = `${tools.length} action${tools.length === 1 ? '' : 's'}`;
    header.addEventListener('click', () => logEl.classList.toggle('collapsed'));
    logEl.appendChild(header);

    tools.forEach(t => {
      const item = document.createElement('div');
      item.className = 'tool-log-item';
      if (typeof t === 'string') { item.innerHTML = `<span class="tool-action">${escapeHtml(t)}</span>`; }
      else { item.innerHTML = `<span class="tool-action">${escapeHtml(t.tool)}</span>${t.detail ? ` ${escapeHtml(t.detail)}` : ''}`; }
      logEl.appendChild(item);
    });
    el.appendChild(logEl);
  }
  return el;
}

export function startRejoinStream() {
  state.isStreaming = true;
  dom.sendBtn.disabled = true;
  state.streamBuffer = '';
  state.toolActions = [];

  const msgEl = createMessageElement('assistant', '');
  msgEl.classList.add('streaming');
  dom.messages.appendChild(msgEl);
  scrollToBottom();
}

export function showWelcomeGuide() {
  if (state.currentConversationId) return;
  if (dom.messages.children.length > 0) return;
  if (state.collectionsList && state.collectionsList.length > 0) return;
  // Don't show if profile already has conversations
  if (dom.convList && dom.convList.children.length > 0) return;

  const oldGuide = document.getElementById('welcome-guide');
  if (oldGuide) return;

  const guide = document.createElement('div');
  guide.id = 'welcome-guide';
  guide.innerHTML = `
    <div class="welcome-heading">Start talking. The AI remembers everything.</div>
    <p class="welcome-text">Whatever you share here — thoughts, decisions, events, reflections — gets filed into your knowledge base. Over time, the AI builds a picture of who you are.</p>
    <div class="welcome-section">
      <div class="welcome-section-title">Skip the cold start</div>
      <p class="welcome-text">The AI is most useful when it already knows you. Add a <strong>collection</strong> — drop in anything from your past and the AI reads, transcribes, and synthesizes it into your knowledge base.</p>
      <div class="welcome-formats">
        <span class="welcome-format">Voice memos</span>
        <span class="welcome-format">PDFs</span>
        <span class="welcome-format">Scanned notebooks</span>
        <span class="welcome-format">Text files</span>
        <span class="welcome-format">Folders of files</span>
        <span class="welcome-format">Zip archives</span>
      </div>
      <div class="welcome-arrow-row">
        <span class="welcome-arrow-label" id="welcome-arrow-anchor">Add your first collection</span>
      </div>
    </div>`;
  dom.messages.appendChild(guide);

  // Draw ant-line once the add-card exists
  const tryDraw = () => {
    if (!document.getElementById('welcome-guide')) return;
    if (document.querySelector('.collection-add-card')) { drawAntLine(); return; }
    setTimeout(tryDraw, 300);
  };
  requestAnimationFrame(tryDraw);
}

/** Remove welcome guide + ant-line (called when collections exist) */
export function removeWelcomeGuide() {
  const guide = document.getElementById('welcome-guide');
  if (guide) guide.remove();
  const svg = document.getElementById('welcome-ant-svg');
  if (svg) svg.remove();
}

function drawAntLine() {
  const anchor = document.getElementById('welcome-arrow-anchor');
  const target = document.querySelector('.collection-add-card');
  if (!anchor || !target) return;

  const old = document.getElementById('welcome-ant-svg');
  if (old) old.remove();

  const a = anchor.getBoundingClientRect();
  const t = target.getBoundingClientRect();

  // Start: right edge of label
  const x1 = a.right + 6;
  const y1 = a.top + a.height / 2;
  // End: stop 18px short of target left edge
  const x2 = t.left - 18;
  const y2 = t.top + t.height / 2;

  // Single cubic bezier — cp1 arcs up from start, cp2 at endpoint Y for horizontal arrival
  const cp1x = x1 + (x2 - x1) * 0.3;
  const cp1y = y1 - 40;
  const cp2x = x2 - (x2 - x1) * 0.3;
  const cp2y = y2;
  const d = `M${x1},${y1} C${cp1x},${cp1y} ${cp2x},${cp2y} ${x2},${y2}`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'welcome-ant-svg';
  svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:50;';

  // Arrowhead marker
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'ant-arrow');
  marker.setAttribute('viewBox', '0 0 8 6');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '3');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('orient', 'auto');
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M0,0 L8,3 L0,6');
  arrow.setAttribute('fill', 'none');
  arrow.setAttribute('stroke', 'var(--accent)');
  arrow.setAttribute('stroke-width', '1');
  arrow.setAttribute('opacity', '0.45');
  marker.appendChild(arrow);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'var(--accent)');
  path.setAttribute('stroke-width', '1');
  path.setAttribute('stroke-dasharray', '4 4');
  path.setAttribute('opacity', '0.35');
  path.setAttribute('marker-end', 'url(#ant-arrow)');
  path.classList.add('ant-line');

  svg.appendChild(path);
  document.body.appendChild(svg);

  const onResize = () => {
    if (!document.getElementById('welcome-guide')) { window.removeEventListener('resize', onResize); svg.remove(); return; }
    drawAntLine();
  };
  window.removeEventListener('resize', drawAntLine);
  window.addEventListener('resize', onResize);
}

export function appendError(text) {
  const el = document.createElement('div');
  el.className = 'message assistant';
  el.innerHTML = `<div class="msg-role" style="color: var(--error)">Error</div><div class="msg-content" style="border-left: 2px solid var(--error); padding-left: 1.2rem;">${escapeHtml(text)}</div>`;
  dom.messages.appendChild(el);
  scrollToBottom();
}
