import { state, dom } from './state.js';
import { send } from './ws.js';
import { escapeHtml, linkifyKbPaths, scrollToBottom } from './utils.js';
import { showOnboarding } from './onboarding.js';
import { showCollectionWizard } from './collections.js';

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
  removeWelcomeGuide();
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
  if (dom.convList && dom.convList.children.length > 0) return;

  const oldGuide = document.getElementById('welcome-guide');
  if (oldGuide) return;

  const hasCollections = state.collectionsList && state.collectionsList.length > 0;
  const showImport = !state.chatgptImported;
  const showCollection = !hasCollections;

  // Nothing to show — user has both done
  if (!showImport && !showCollection) return;

  const guide = document.createElement('div');
  guide.id = 'welcome-guide';

  let cardsHtml = '';
  if (showImport) {
    cardsHtml += `
      <div class="welcome-card" id="welcome-card-import">
        <div class="welcome-card-title">Import ChatGPT history</div>
        <p class="welcome-card-desc">Already talk to ChatGPT? Import your export and the AI instantly learns who you are from thousands of past conversations.</p>
        <button class="welcome-card-btn">Import</button>
      </div>`;
  }
  if (showCollection) {
    cardsHtml += `
      <div class="welcome-card" id="welcome-card-collection">
        <div class="welcome-card-title">Add a collection</div>
        <p class="welcome-card-desc">Drop in anything from your past — voice memos, notebooks, PDFs, text files — and the AI reads, transcribes, and synthesizes it.</p>
        <button class="welcome-card-btn">Add collection</button>
      </div>`;
  }

  guide.innerHTML = `
    <div class="welcome-heading">Start talking. The AI remembers everything.</div>
    <p class="welcome-text">Whatever you share here — thoughts, decisions, events, reflections — gets filed into your knowledge base. Over time, the AI builds a picture of who you are.</p>
    <div class="welcome-section">
      <div class="welcome-section-title">Skip the cold start</div>
      <p class="welcome-text">The AI is most useful when it already knows you.</p>
      <div class="welcome-cards">${cardsHtml}</div>
    </div>`;
  dom.messages.appendChild(guide);

  // Wire up card clicks
  const importCard = guide.querySelector('#welcome-card-import');
  if (importCard) importCard.addEventListener('click', () => showOnboarding());
  const collectionCard = guide.querySelector('#welcome-card-collection');
  if (collectionCard) collectionCard.addEventListener('click', () => showCollectionWizard());
}

/** Remove welcome guide (called when collections exist or user starts chatting) */
export function removeWelcomeGuide() {
  const guide = document.getElementById('welcome-guide');
  if (guide) guide.remove();
}

export function appendError(text) {
  const el = document.createElement('div');
  el.className = 'message assistant';
  el.innerHTML = `<div class="msg-role" style="color: var(--error)">Error</div><div class="msg-content" style="border-left: 2px solid var(--error); padding-left: 1.2rem;">${escapeHtml(text)}</div>`;
  dom.messages.appendChild(el);
  scrollToBottom();
}
