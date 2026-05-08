import { state, dom } from './state.js';
import { send } from './ws.js';
import { escapeHtml, formatTime, scrollToBottom } from './utils.js';
import { appendMessage } from './chat.js';

export function renderConversationList(list) {
  dom.convList.innerHTML = list.map(c => `
    <div class="conv-item ${c.id === state.currentConversationId ? 'active' : ''} ${c.active ? 'running' : ''}" data-id="${c.id}">
      <div class="conv-title">${c.active ? '<span class="active-dot"></span>' : ''}${escapeHtml(c.title)}</div>
      <div class="conv-meta">
        <span>${formatTime(c.updatedAt)}</span>
        <span class="conv-delete" data-id="${c.id}" title="Delete">&times;</span>
      </div>
    </div>
  `).join('');

  dom.convList.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('conv-delete')) return;
      const id = el.dataset.id;
      if (id !== state.currentConversationId) send({ type: 'load_conversation', conversationId: id });
    });
  });

  dom.convList.querySelectorAll('.conv-delete').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      send({ type: 'delete_conversation', conversationId: el.dataset.id });
    });
  });
}

export function loadConversationUI(conv) {
  state.currentConversationId = conv.id;
  dom.messages.innerHTML = '';
  conv.messages.forEach(m => appendMessage(m.role, m.content, false, m.toolsUsed));
  scrollToBottom();

  dom.convList.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === conv.id);
  });
}

export function newConversation() {
  send({ type: 'new_conversation' });
}
