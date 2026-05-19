import { state, dom } from './js/state.js';
import { connect, send } from './js/ws.js';
import { sendMessage } from './js/chat.js';
import { newConversation } from './js/conversations.js';
import { toggleSidebar, toggleExplorer } from './js/explorer.js';
import { setupProfileListeners } from './js/profiles.js';
import { setupCollectionListeners } from './js/collection-browser.js';

// --- Input Handling ---

dom.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

dom.chatInput.addEventListener('input', () => {
  dom.chatInput.style.height = 'auto';
  dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 150) + 'px';
});

dom.sendBtn.addEventListener('click', sendMessage);
document.getElementById('new-chat-btn').addEventListener('click', newConversation);
document.getElementById('toggle-sidebar').addEventListener('click', toggleSidebar);
document.getElementById('toggle-explorer').addEventListener('click', toggleExplorer);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); newConversation(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); toggleSidebar(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'e') { e.preventDefault(); toggleExplorer(); }
});

// KB path links in messages
dom.messages.addEventListener('click', (e) => {
  const link = e.target.closest('.kb-link');
  if (link) { e.preventDefault(); send({ type: 'read_file', path: link.dataset.path }); }
});

// Model selector
document.getElementById('model-selector').addEventListener('click', (e) => {
  const btn = e.target.closest('.model-opt');
  if (!btn) return;
  document.querySelectorAll('.model-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.selectedModel = btn.dataset.model;
});

// --- Init ---
setupProfileListeners();
setupCollectionListeners();
connect();
