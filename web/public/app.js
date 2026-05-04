// --- State ---
let ws = null;
let currentConversationId = null;
let isStreaming = false;
let streamBuffer = '';
let renderTimer = null;
let openTabs = []; // { path, content }
let activeTabPath = null;
let sidebarCollapsed = false;
let explorerCollapsed = false;
let onboardingRequired = false;
let liveTreePaths = new Set(); // tracks file paths in live tree during import

// --- DOM ---
const $ = (sel) => document.querySelector(sel);
const app = $('#app');
const sidebar = $('#sidebar');
const explorerPanel = $('#explorer-panel');
const convList = $('#conversation-list');
const messages = $('#messages');
let toolActions = []; // accumulates during streaming: [{ tool, detail }]
const chatInput = $('#chat-input');
const sendBtn = $('#send-btn');
const fileTree = $('#file-tree');
const fileTabs = $('#file-tabs');
const fileViewer = $('#file-viewer');
const inboxBadge = $('#inbox-badge');
const inboxCount = $('#inbox-count');
const dropOverlay = $('#drop-overlay');

// --- Panel Collapse ---

function updateGridLayout() {
  const left = sidebarCollapsed ? '0px' : '260px';
  const right = explorerCollapsed ? '0px' : '300px';
  app.style.gridTemplateColumns = `${left} 1fr ${right}`;
  sidebar.classList.toggle('collapsed', sidebarCollapsed);
  explorerPanel.classList.toggle('collapsed', explorerCollapsed);
}

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  updateGridLayout();
}

function toggleExplorer() {
  explorerCollapsed = !explorerCollapsed;
  updateGridLayout();
}

// --- WebSocket ---

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    send({ type: 'list_profiles' });
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    setTimeout(connect, 2000);
  };
}

function send(data) {
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

// --- Message Handler ---

function handleMessage(msg) {
  switch (msg.type) {
    case 'conversations':
      renderConversationList(msg.list);
      break;

    case 'conversation':
      loadConversationUI(msg.data);
      break;

    case 'stream':
      handleStreamChunk(msg.text);
      break;

    case 'stream_reset':
      handleStreamReset(msg.text);
      break;

    case 'tool_use':
      addToolAction(msg.tool, msg.detail);
      break;

    case 'response_complete':
      finishStreaming(msg.costUsd, msg.finalText);
      send({ type: 'list_conversations' });
      break;

    case 'error':
      appendError(msg.message);
      finishStreaming();
      break;

    case 'file_tree':
    case 'file_tree_update':
      renderFileTree(msg.tree);
      break;

    case 'file_content': {
      // During onboarding, show in live preview instead of explorer tab
      const livePreview = document.getElementById('live-preview');
      if (livePreview && !livePreview.classList.contains('hidden')) {
        const contentEl = document.getElementById('live-preview-content');
        if (contentEl) {
          contentEl.innerHTML = msg.path.endsWith('.md')
            ? marked.parse(msg.content)
            : `<pre><code>${escapeHtml(msg.content)}</code></pre>`;
        }
      } else {
        openFileTab(msg.path, msg.content);
      }
      break;
    }

    case 'inbox_update':
      updateInbox(msg.items);
      break;

    case 'conversation_deleted':
      if (msg.conversationId === currentConversationId) {
        currentConversationId = null;
        messages.innerHTML = '';
      }
      send({ type: 'list_conversations' });
      break;

    // --- Profiles ---
    case 'profiles':
      showProfilePicker(msg.profiles, msg.active);
      break;

    case 'profile_selected':
      cachedActiveProfile = msg.name;
      cachedProfiles = msg.profiles || cachedProfiles;
      document.getElementById('profile-name').textContent = msg.name;
      hideProfilePicker();
      // Clear current conversation and reload everything for new profile
      currentConversationId = null;
      messages.innerHTML = '';
      send({ type: 'check_onboarding' });
      break;

    case 'profile_deleted':
      cachedProfiles = msg.profiles || [];
      cachedActiveProfile = msg.active;
      document.getElementById('profile-name').textContent = msg.active || '\u2014';
      if (!msg.active) {
        // No profiles left — show first-time setup
        currentConversationId = null;
        messages.innerHTML = '';
        showFirstTimeProfileSetup();
      } else {
        // Switched to another profile after deletion
        currentConversationId = null;
        messages.innerHTML = '';
        send({ type: 'check_onboarding' });
      }
      break;

    // --- Onboarding ---
    case 'onboarding_status':
      if (msg.required) {
        showOnboarding();
      } else {
        hideOnboarding();
        send({ type: 'list_conversations' });
        send({ type: 'file_tree' });
      }
      break;

    case 'import_parsed':
      updateOnboardingParsed(msg);
      break;

    case 'import_progress':
      updateOnboardingProgress(msg);
      break;

    case 'import_tool_activity':
      break; // handled visually via import_file_created

    case 'import_file_created':
      addLiveFileCreated(msg);
      break;

    case 'import_complete':
      showOnboardingComplete(msg);
      break;

    case 'import_error':
      showOnboardingError(msg.message);
      break;

    case 'onboarding_complete':
      hideOnboarding();
      send({ type: 'list_conversations' });
      send({ type: 'file_tree' });
      break;
  }
}

// --- Conversations ---

function renderConversationList(list) {
  convList.innerHTML = list.map(c => `
    <div class="conv-item ${c.id === currentConversationId ? 'active' : ''}"
         data-id="${c.id}">
      <div class="conv-title">${escapeHtml(c.title)}</div>
      <div class="conv-meta">
        <span>${formatTime(c.updatedAt)}</span>
        <span class="conv-delete" data-id="${c.id}" title="Delete">&times;</span>
      </div>
    </div>
  `).join('');

  convList.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't load if clicking delete
      if (e.target.classList.contains('conv-delete')) return;
      const id = el.dataset.id;
      if (id !== currentConversationId) {
        send({ type: 'load_conversation', conversationId: id });
      }
    });
  });

  convList.querySelectorAll('.conv-delete').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.id;
      send({ type: 'delete_conversation', conversationId: id });
    });
  });
}

function loadConversationUI(conv) {
  currentConversationId = conv.id;
  messages.innerHTML = '';

  conv.messages.forEach(m => {
    appendMessage(m.role, m.content, false, m.toolsUsed);
  });

  scrollToBottom();

  // Highlight active in sidebar
  convList.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === conv.id);
  });
}

function newConversation() {
  send({ type: 'new_conversation' });
}

// --- Chat ---

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isStreaming) return;

  if (!currentConversationId) {
    const tempHandler = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'conversation') {
        ws.removeEventListener('message', tempHandler);
        currentConversationId = msg.data.id;
        sendChatMessage(text);
      }
    };
    ws.addEventListener('message', tempHandler);
    send({ type: 'new_conversation' });
    return;
  }

  sendChatMessage(text);
}

function sendChatMessage(text) {
  appendMessage('user', text, false);
  send({ type: 'chat', conversationId: currentConversationId, text });
  chatInput.value = '';
  chatInput.style.height = 'auto';
  isStreaming = true;
  sendBtn.disabled = true;
  streamBuffer = '';
  toolActions = [];

  const msgEl = createMessageElement('assistant', '');
  msgEl.classList.add('streaming');
  messages.appendChild(msgEl);
  scrollToBottom();
}

function handleStreamChunk(text) {
  streamBuffer += text;
  if (!renderTimer) {
    renderTimer = requestAnimationFrame(() => {
      const streamingMsg = messages.querySelector('.message.streaming .msg-content');
      if (streamingMsg) {
        streamingMsg.innerHTML = linkifyKbPaths(marked.parse(streamBuffer));
      }
      scrollToBottom();
      renderTimer = null;
    });
  }
}

function handleStreamReset(cleanText) {
  // Server detected intermediate thinking text — replace buffer with clean text
  streamBuffer = cleanText || '';
  const streamingMsg = messages.querySelector('.message.streaming .msg-content');
  if (streamingMsg) {
    streamingMsg.innerHTML = streamBuffer ? linkifyKbPaths(marked.parse(streamBuffer)) : '';
  }
}

function addToolAction(tool, detail) {
  toolActions.push({ tool, detail });

  const streamingEl = messages.querySelector('.message.streaming');
  if (!streamingEl) return;

  let logEl = streamingEl.querySelector('.tool-log');
  if (!logEl) {
    logEl = document.createElement('div');
    logEl.className = 'tool-log';
    streamingEl.appendChild(logEl);
  }

  const item = document.createElement('div');
  item.className = 'tool-log-item';
  const detailText = detail ? ` ${escapeHtml(detail)}` : '';
  item.innerHTML = `<span class="tool-action">${escapeHtml(tool)}</span>${detailText}`;
  logEl.appendChild(item);
  scrollToBottom();
}

function finishStreaming(costUsd, finalText) {
  isStreaming = false;
  sendBtn.disabled = false;

  const streamingEl = messages.querySelector('.message.streaming');
  if (streamingEl) {
    const contentEl = streamingEl.querySelector('.msg-content');
    if (contentEl) {
      const displayText = finalText || streamBuffer;
      contentEl.innerHTML = linkifyKbPaths(marked.parse(displayText));
    }

    // Collapse tool log into a toggleable summary
    const logEl = streamingEl.querySelector('.tool-log');
    if (logEl && toolActions.length > 0) {
      logEl.classList.add('collapsed');
      const header = document.createElement('div');
      header.className = 'tool-log-header';
      header.textContent = `${toolActions.length} action${toolActions.length === 1 ? '' : 's'}`;
      header.addEventListener('click', () => logEl.classList.toggle('collapsed'));
      logEl.prepend(header);
    }

    streamingEl.classList.remove('streaming');
  }

  streamBuffer = '';
  toolActions = [];
  scrollToBottom();
  chatInput.focus();
}

function appendMessage(role, content, scroll = true, tools) {
  const el = createMessageElement(role, content, tools);
  messages.appendChild(el);
  if (scroll) scrollToBottom();
}

function createMessageElement(role, content, tools) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  const rendered = content ? linkifyKbPaths(marked.parse(content)) : '';
  el.innerHTML = `<div class="msg-role">${role}</div><div class="msg-content">${rendered}</div>`;

  // Render saved tool activity log (collapsed by default)
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
      // Handle both old format (string) and new format ({ tool, detail })
      if (typeof t === 'string') {
        item.innerHTML = `<span class="tool-action">${escapeHtml(t)}</span>`;
      } else {
        const detailText = t.detail ? ` ${escapeHtml(t.detail)}` : '';
        item.innerHTML = `<span class="tool-action">${escapeHtml(t.tool)}</span>${detailText}`;
      }
      logEl.appendChild(item);
    });

    el.appendChild(logEl);
  }

  return el;
}

function appendError(text) {
  const el = document.createElement('div');
  el.className = 'message assistant';
  el.innerHTML = `
    <div class="msg-role" style="color: var(--error)">Error</div>
    <div class="msg-content" style="border-left: 2px solid var(--error); padding-left: 1.2rem;">${escapeHtml(text)}</div>
  `;
  messages.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

// --- File Explorer ---

function renderFileTree(tree) {
  fileTree.innerHTML = '';
  tree.forEach(node => fileTree.appendChild(createTreeNode(node, 0)));
}

function createTreeNode(node, depth) {
  const wrapper = document.createElement('div');
  wrapper.className = node.type === 'directory' ? 'tree-dir' : 'tree-file';

  const item = document.createElement('div');
  item.className = 'tree-item';
  item.style.paddingLeft = `${8 + depth * 16}px`;

  const icon = document.createElement('span');
  icon.className = 'tree-icon';

  if (node.type === 'directory') {
    wrapper.classList.add('collapsed');
    icon.textContent = '\u25B6';

    item.addEventListener('click', () => {
      wrapper.classList.toggle('collapsed');
      icon.textContent = wrapper.classList.contains('collapsed') ? '\u25B6' : '\u25BC';
    });
  } else {
    icon.textContent = '\u25A0';
    item.addEventListener('click', () => {
      send({ type: 'read_file', path: node.path });
    });
  }

  const name = document.createElement('span');
  name.className = 'tree-name';
  name.textContent = node.name;

  item.appendChild(icon);
  item.appendChild(name);
  wrapper.appendChild(item);

  if (node.children) {
    const children = document.createElement('div');
    children.className = 'tree-children';
    node.children.forEach(child => children.appendChild(createTreeNode(child, depth + 1)));
    wrapper.appendChild(children);
  }

  return wrapper;
}

// --- File Tabs ---

function openFileTab(filePath, content) {
  const existing = openTabs.find(t => t.path === filePath);
  if (existing) {
    existing.content = content;
  } else {
    openTabs.push({ path: filePath, content });
  }
  activeTabPath = filePath;
  // Auto-expand explorer if collapsed
  if (explorerCollapsed) toggleExplorer();
  renderTabs();
  renderFileContent(content, filePath);
}

function closeTab(filePath) {
  openTabs = openTabs.filter(t => t.path !== filePath);
  if (activeTabPath === filePath) {
    activeTabPath = openTabs.length > 0 ? openTabs[openTabs.length - 1].path : null;
  }
  renderTabs();
  if (activeTabPath) {
    const tab = openTabs.find(t => t.path === activeTabPath);
    if (tab) renderFileContent(tab.content, tab.path);
  } else {
    fileViewer.classList.add('hidden');
  }
}

function renderTabs() {
  fileTabs.innerHTML = openTabs.map(t => {
    const name = t.path.split('/').pop();
    return `
      <div class="file-tab ${t.path === activeTabPath ? 'active' : ''}" data-path="${t.path}">
        <span class="tab-name">${escapeHtml(name)}</span>
        <span class="tab-close" data-close="${t.path}">&times;</span>
      </div>
    `;
  }).join('');

  fileTabs.querySelectorAll('.file-tab').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        closeTab(e.target.dataset.close);
        return;
      }
      const p = el.dataset.path;
      activeTabPath = p;
      renderTabs();
      const tab = openTabs.find(t => t.path === p);
      if (tab) renderFileContent(tab.content, tab.path);
    });
  });
}

function renderFileContent(content, filePath) {
  fileViewer.classList.remove('hidden');
  if (filePath.endsWith('.md')) {
    fileViewer.innerHTML = marked.parse(content);
  } else {
    fileViewer.innerHTML = `<pre><code>${escapeHtml(content)}</code></pre>`;
  }
}

// --- Inbox ---

function updateInbox(items) {
  const pending = items.filter(i => i.status === 'pending');
  if (pending.length > 0) {
    inboxBadge.classList.remove('hidden');
    inboxCount.textContent = pending.length;
  } else {
    inboxBadge.classList.add('hidden');
  }
}

// --- Drag & Drop ---

function setupDragDrop() {
  const chatPanel = $('#chat-panel');
  let dragCounter = 0;

  chatPanel.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.remove('hidden');
  });

  chatPanel.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) dropOverlay.classList.add('hidden');
  });

  chatPanel.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  chatPanel.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.add('hidden');

    const files = e.dataTransfer.files;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        send({ type: 'upload', filename: file.name, data: base64 });
      };
      reader.readAsDataURL(file);
    }
  });
}

// --- Inbox Badge Click ---

inboxBadge.addEventListener('click', () => {
  chatInput.value = 'Hey Claude, process the items in my inbox';
  chatInput.focus();
});

// --- Input Handling ---

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
});

sendBtn.addEventListener('click', sendMessage);
$('#new-chat-btn').addEventListener('click', newConversation);
$('#toggle-sidebar').addEventListener('click', toggleSidebar);
$('#toggle-explorer').addEventListener('click', toggleExplorer);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    newConversation();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    toggleSidebar();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
    e.preventDefault();
    toggleExplorer();
  }
});

// --- KB Path Linking ---

function linkifyKbPaths(html) {
  // Match user/... file paths (e.g. user/record/journal/2026-05-04.md)
  // Works both in plain text and inside <code> tags
  return html.replace(/(?:`)?(user\/[\w\-\.\/]+\.[\w]+)(?:`)?/g, (match, filepath) => {
    // Strip user/ prefix — server read_file expects paths relative to user/
    const relPath = filepath.replace(/^user\//, '');
    return `<a class="kb-link" href="#" data-path="${relPath}" title="Open in explorer">${filepath}</a>`;
  });
}

// Delegate clicks on kb-links in messages
messages.addEventListener('click', (e) => {
  const link = e.target.closest('.kb-link');
  if (link) {
    e.preventDefault();
    send({ type: 'read_file', path: link.dataset.path });
  }
});

// --- Utilities ---

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

// --- Profile Switcher (dropdown in explorer header) ---

let cachedProfiles = [];
let cachedActiveProfile = null;
let profileDropdownOpen = false;

function showProfilePicker(profiles, active) {
  cachedProfiles = profiles;
  cachedActiveProfile = active;

  // Update name in explorer header
  const nameEl = document.getElementById('profile-name');
  if (nameEl) nameEl.textContent = active || '—';

  // If no profiles exist, show the full-screen picker for first-time setup
  if (profiles.length === 0) {
    showFirstTimeProfileSetup();
    return;
  }

  // If there's no active profile, auto-select the first one
  if (!active && profiles.length > 0) {
    send({ type: 'select_profile', name: profiles[0].name });
    return;
  }

  // Active profile exists — proceed to onboarding check
  if (active) {
    send({ type: 'check_onboarding' });
  }
}

function renderProfileDropdown() {
  const dropdown = document.getElementById('profile-dropdown');
  if (!dropdown) return;

  dropdown.innerHTML = `
    ${cachedProfiles.map(p => `
      <div class="dropdown-profile ${p.name === cachedActiveProfile ? 'active' : ''}" data-name="${escapeHtml(p.name)}">
        <span>${escapeHtml(p.name)}</span>
        <span class="dp-actions">
          ${p.name === cachedActiveProfile ? '<span class="dp-status">active</span>' : ''}
          <span class="dp-delete" data-name="${escapeHtml(p.name)}" title="Delete profile">&times;</span>
        </span>
      </div>
    `).join('')}
    <div class="dropdown-divider"></div>
    <div class="dropdown-create">
      <input type="text" id="dropdown-new-name" placeholder="New profile..." maxlength="40" />
      <button id="dropdown-create-btn">+</button>
    </div>
  `;

  // Profile selection
  dropdown.querySelectorAll('.dropdown-profile').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.dp-delete')) return; // handled below
      e.stopPropagation();
      const name = el.dataset.name;
      if (name !== cachedActiveProfile) {
        send({ type: 'select_profile', name });
      }
      toggleProfileDropdown(false);
    });
  });

  // Profile deletion
  dropdown.querySelectorAll('.dp-delete').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = el.dataset.name;
      if (confirm(`Delete profile "${name}"? This will permanently remove all their KB data.`)) {
        send({ type: 'delete_profile', name });
        toggleProfileDropdown(false);
      }
    });
  });

  // Create new
  const nameInput = document.getElementById('dropdown-new-name');
  const createBtn = document.getElementById('dropdown-create-btn');

  createBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const name = nameInput.value.trim();
    if (name) {
      send({ type: 'create_profile', name });
      toggleProfileDropdown(false);
    }
  });

  nameInput.addEventListener('keydown', (e) => {
    e.stopPropagation(); // don't trigger app shortcuts
    if (e.key === 'Enter') {
      const name = nameInput.value.trim();
      if (name) {
        send({ type: 'create_profile', name });
        toggleProfileDropdown(false);
      }
    }
  });

  // Prevent clicks on the input from toggling dropdown
  nameInput.addEventListener('click', (e) => e.stopPropagation());
}

function toggleProfileDropdown(forceState) {
  const dropdown = document.getElementById('profile-dropdown');
  if (!dropdown) return;

  profileDropdownOpen = forceState !== undefined ? forceState : !profileDropdownOpen;
  dropdown.classList.toggle('hidden', !profileDropdownOpen);

  if (profileDropdownOpen) {
    renderProfileDropdown();
  }
}

function showFirstTimeProfileSetup() {
  const existing = document.getElementById('profile-picker');
  if (existing) return;

  const overlay = document.createElement('div');
  overlay.id = 'profile-picker';
  overlay.innerHTML = `
    <div class="profile-picker-container">
      <h1>Welcome to ClaudeGPT</h1>
      <p class="profile-subtitle">Create your profile to get started.</p>
      <div class="profile-create">
        <input type="text" id="new-profile-name" placeholder="Your name..." maxlength="40" autofocus />
        <button id="create-profile-btn" class="onboarding-btn primary">Create</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const nameInput = document.getElementById('new-profile-name');
  const createBtn = document.getElementById('create-profile-btn');

  const doCreate = () => {
    const name = nameInput.value.trim();
    if (name) send({ type: 'create_profile', name });
  };

  createBtn.addEventListener('click', doCreate);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
}

function hideProfilePicker() {
  const picker = document.getElementById('profile-picker');
  if (picker) {
    picker.classList.add('fading');
    setTimeout(() => picker.remove(), 300);
  }
  // Update name
  const nameEl = document.getElementById('profile-name');
  if (nameEl && cachedActiveProfile) nameEl.textContent = cachedActiveProfile;
}

// --- Onboarding ---

function showOnboarding() {
  onboardingRequired = true;

  const overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.innerHTML = `
    <div id="onboarding-container">
      <div id="onboarding-steps">
        <div class="step-indicator">
          <span class="step active current" data-step="1">1</span>
          <span class="step-line"></span>
          <span class="step" data-step="2">2</span>
          <span class="step-line"></span>
          <span class="step" data-step="3">3</span>
          <span class="step-line"></span>
          <span class="step" data-step="4">4</span>
        </div>
      </div>

      <div id="onboarding-content">
        <!-- Step 1: Instructions -->
        <div id="step-1" class="onboarding-step active">
          <h1>Import your ChatGPT history</h1>
          <p class="onboarding-subtitle">ClaudeGPT builds a knowledge base about you from your conversations. The fastest way to start is importing your ChatGPT export — years of context, instantly.</p>

          <div class="instruction-video">
            <video controls preload="metadata">
              <source src="/chatgpt-export-tutorial.mp4" type="video/mp4">
            </video>
          </div>

          <div class="instruction-steps">
            <div class="instruction-step">
              <span class="instruction-number">1</span>
              <div>
                <strong>Open ChatGPT Settings</strong>
                <p>Go to chatgpt.com, click your profile icon, then Settings</p>
              </div>
            </div>
            <div class="instruction-step">
              <span class="instruction-number">2</span>
              <div>
                <strong>Request your data</strong>
                <p>Data Controls &rarr; Export Data &rarr; Confirm export</p>
              </div>
            </div>
            <div class="instruction-step">
              <span class="instruction-number">3</span>
              <div>
                <strong>Wait for the email</strong>
                <p>OpenAI sends a download link within minutes to hours</p>
              </div>
            </div>
            <div class="instruction-step">
              <span class="instruction-number">4</span>
              <div>
                <strong>Download the zip</strong>
                <p>Click the link in the email to download your export zip file</p>
              </div>
            </div>
          </div>

          <div class="onboarding-actions">
            <button id="onboarding-next" class="onboarding-btn primary">I have my export</button>
            <button id="onboarding-skip" class="onboarding-btn secondary">Skip for now</button>
          </div>
        </div>

        <!-- Step 2: Upload -->
        <div id="step-2" class="onboarding-step">
          <h1>Drop your export</h1>
          <p class="onboarding-subtitle">Drag your ChatGPT export zip file here, or click to browse.</p>

          <div id="onboarding-dropzone">
            <div class="dropzone-content">
              <div class="dropzone-icon">&#8681;</div>
              <p>Drop your .zip file here</p>
              <p class="dropzone-hint">or click to browse</p>
            </div>
            <input type="file" id="onboarding-file-input" accept=".zip" hidden>
          </div>

          <div id="upload-status" class="hidden">
            <p id="upload-status-text">Reading file...</p>
          </div>

          <div class="onboarding-actions">
            <button id="onboarding-back-1" class="onboarding-btn secondary">Back</button>
          </div>
        </div>

        <!-- Step 3: Live Construction -->
        <div id="step-3" class="onboarding-step">
          <div id="import-vision">
            <h1>Claude is reading your history</h1>
            <p class="vision-text">Every conversation you've ever had with ChatGPT contains fragments of who you are — goals you mentioned once and forgot, people you talked about, decisions you wrestled with, feelings you processed out loud. Most of that context disappears between sessions.</p>
            <p class="vision-text">Right now, Claude is reading through all of it and building a <strong>persistent knowledge base</strong> — a structured map of your life that carries forward into every future conversation. It's finding patterns you didn't know were there, connecting threads across months and years.</p>
            <p class="vision-text dim">Watch the right panel — you'll see your life being organized in real time.</p>
          </div>

          <div id="processing-stats" class="hidden">
            <div class="stat">
              <span class="stat-value" id="stat-total">0</span>
              <span class="stat-label">files found</span>
            </div>
            <div class="stat">
              <span class="stat-value" id="stat-substantive">0</span>
              <span class="stat-label">data size</span>
            </div>
          </div>

          <div id="progress-bar"><div id="progress-fill"></div></div>
          <p id="progress-text">Reading your export...</p>

          <div class="live-construction">
            <div class="live-tree" id="live-tree"></div>
            <div class="live-feed" id="live-feed"></div>
            <div class="live-preview hidden" id="live-preview">
              <div class="live-preview-header">
                <span class="live-preview-path" id="live-preview-path"></span>
                <button class="live-preview-close" id="live-preview-close">&times;</button>
              </div>
              <div class="live-preview-content" id="live-preview-content"></div>
            </div>
          </div>
        </div>

        <!-- Step 4: Complete -->
        <div id="step-4" class="onboarding-step">
          <h1>You have a knowledge base</h1>
          <p class="onboarding-subtitle">Claude read through your history and built a structured map of your life. From here, every conversation builds on everything that came before. No more starting from scratch.</p>

          <div class="completion-stats" id="completion-stats"></div>

          <div class="onboarding-actions">
            <button id="onboarding-finish" class="onboarding-btn primary">Start talking</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  setupOnboardingListeners();

  // Live preview close button
  document.getElementById('live-preview-close').addEventListener('click', closeLivePreview);
}

function setupOnboardingListeners() {
  // Step 1 → Step 2
  document.getElementById('onboarding-next').addEventListener('click', () => {
    switchOnboardingStep(2);
  });

  // Skip
  document.getElementById('onboarding-skip').addEventListener('click', () => {
    send({ type: 'skip_onboarding' });
  });

  // Back
  document.getElementById('onboarding-back-1').addEventListener('click', () => {
    switchOnboardingStep(1);
  });

  // Drop zone
  const dropzone = document.getElementById('onboarding-dropzone');
  const fileInput = document.getElementById('onboarding-file-input');

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleExportFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleExportFile(fileInput.files[0]);
  });
}

function handleExportFile(file) {
  if (!file.name.endsWith('.zip')) {
    showOnboardingError('Please upload a .zip file');
    return;
  }

  const status = document.getElementById('upload-status');
  const statusText = document.getElementById('upload-status-text');
  status.classList.remove('hidden');
  statusText.textContent = `Reading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`;

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    statusText.textContent = 'Uploading...';
    send({ type: 'upload_chatgpt_export', data: base64 });
    switchOnboardingStep(3);
  };
  reader.onerror = () => {
    statusText.textContent = 'Failed to read file. Try again.';
  };
  reader.readAsDataURL(file);
}

function switchOnboardingStep(n) {
  document.querySelectorAll('.onboarding-step').forEach(el => el.classList.remove('active'));
  document.getElementById(`step-${n}`).classList.add('active');
  document.querySelectorAll('.step-indicator .step').forEach(el => {
    const stepNum = parseInt(el.dataset.step);
    el.classList.toggle('active', stepNum <= n);
    el.classList.toggle('current', stepNum === n);
  });

  // Widen container for live construction view
  const container = document.getElementById('onboarding-container');
  container.classList.toggle('wide', n === 3);
}

function updateOnboardingParsed(msg) {
  document.getElementById('stat-total').textContent =
    msg.totalConversations || msg.totalFiles || 0;
  document.getElementById('stat-substantive').textContent =
    msg.totalSize ? `${(msg.totalSize / 1024).toFixed(0)} KB` : '0';
  document.getElementById('processing-stats').classList.remove('hidden');

  // Update stat labels based on what we found
  const labels = document.querySelectorAll('#processing-stats .stat-label');
  if (labels[0]) labels[0].textContent = msg.totalConversations ? 'conversations' : 'files';

  document.getElementById('progress-text').textContent =
    msg.totalConversations
      ? `Found ${msg.totalConversations} conversations — Claude is reading them now...`
      : `Found ${msg.totalFiles} files — Claude is reading them now...`;

  // Show conversation topic preview if available
  if (msg.convTitles && msg.convTitles.length > 0) {
    const vision = document.getElementById('import-vision');
    if (vision) {
      const preview = document.createElement('div');
      preview.className = 'conv-preview';
      const sample = msg.convTitles.slice(0, 12);
      const remaining = msg.convTitles.length - sample.length;
      preview.innerHTML = `
        <p class="preview-label">Some of what Claude is reading through:</p>
        <div class="preview-topics">
          ${sample.map(t => `<span class="preview-topic">${escapeHtml(t)}</span>`).join('')}
          ${remaining > 0 ? `<span class="preview-more">+${remaining} more</span>` : ''}
        </div>
      `;
      vision.appendChild(preview);
    }
  }
}

const PROGRESS_MESSAGES = [
  'Reading through your conversations...',
  'Finding the people in your life...',
  'Identifying goals and aspirations...',
  'Capturing moments that mattered...',
  'Tracing patterns across conversations...',
  'Connecting threads across time...',
  'Extracting creative work and reflections...',
  'Building your relationship map...',
  'Discovering recurring themes...',
  'Mapping your decisions and turning points...',
  'Piecing together your story...',
  'Finding what you talked about most...',
  'Separating signal from noise...',
  'Organizing years of context...',
  'Your history is becoming a knowledge base...',
];

function updateOnboardingProgress(msg) {
  const pct = msg.phase === 'synthesizing'
    ? 90
    : Math.round((msg.batch / msg.totalBatches) * 85);
  document.getElementById('progress-fill').style.width = `${pct}%`;

  if (msg.phase === 'synthesizing') {
    document.getElementById('progress-text').textContent =
      'Synthesizing everything into a profile of who you are...';
  } else {
    // Rotate through narrative messages
    const msgIdx = (msg.batch - 1) % PROGRESS_MESSAGES.length;
    document.getElementById('progress-text').textContent = PROGRESS_MESSAGES[msgIdx];
  }
}

function openLivePreview(relPath) {
  send({ type: 'read_file', path: relPath });
  // Show preview pane, hide feed
  const preview = document.getElementById('live-preview');
  const feed = document.getElementById('live-feed');
  if (preview && feed) {
    feed.classList.add('hidden');
    preview.classList.remove('hidden');
    document.getElementById('live-preview-path').textContent = relPath;
    document.getElementById('live-preview-content').innerHTML = '<p style="color:var(--text-muted)">Loading...</p>';
  }
}

function closeLivePreview() {
  const preview = document.getElementById('live-preview');
  const feed = document.getElementById('live-feed');
  if (preview && feed) {
    preview.classList.add('hidden');
    feed.classList.remove('hidden');
  }
}

function addLiveFileCreated(msg) {
  // Add to live tree
  const treeEl = document.getElementById('live-tree');
  if (treeEl && !liveTreePaths.has(msg.filePath)) {
    liveTreePaths.add(msg.filePath);

    // Build tree items for any missing parent directories
    const parts = msg.filePath.split('/');
    let pathSoFar = '';
    for (let i = 0; i < parts.length; i++) {
      pathSoFar += (i > 0 ? '/' : '') + parts[i];
      if (!liveTreePaths.has(pathSoFar)) {
        liveTreePaths.add(pathSoFar);
        if (i < parts.length - 1) {
          // Directory
          const dirItem = document.createElement('div');
          dirItem.className = 'live-tree-item is-dir';
          dirItem.style.paddingLeft = `${0.75 + i * 0.8}rem`;
          dirItem.textContent = parts[i] + '/';
          treeEl.appendChild(dirItem);
        }
      }
    }

    // File entry
    const fileItem = document.createElement('div');
    fileItem.className = 'live-tree-item is-file';
    fileItem.style.paddingLeft = `${0.75 + (parts.length - 1) * 0.8}rem`;
    fileItem.textContent = parts[parts.length - 1];
    // Strip user/ prefix for read_file API
    const relPath = msg.filePath.replace(/^user\//, '');
    fileItem.dataset.path = relPath;
    fileItem.addEventListener('click', () => openLivePreview(relPath));
    treeEl.appendChild(fileItem);
    treeEl.scrollTop = treeEl.scrollHeight;
  }

  // Add to live feed
  const feedEl = document.getElementById('live-feed');
  if (feedEl) {
    const item = document.createElement('div');
    item.className = 'feed-item';

    const actionClass = msg.action === 'updated' ? 'updated' : '';
    const cleanSnippet = msg.snippet
      ? msg.snippet.replace(/^---[\s\S]*?---\n*/, '').trim()
      : '';
    const snippet = cleanSnippet
      ? `<div class="feed-snippet">${marked.parse(cleanSnippet)}</div>`
      : '';
    const relPath = msg.filePath.replace(/^user\//, '');

    item.innerHTML = `
      <div class="feed-item-header">
        <span class="feed-action ${actionClass}">${msg.action}</span>
        <span class="feed-path" data-path="${escapeHtml(relPath)}">${escapeHtml(msg.filePath)}</span>
      </div>
      ${snippet}
    `;

    // Make feed path clickable
    item.querySelector('.feed-path').addEventListener('click', () => openLivePreview(relPath));

    // Insert at top
    feedEl.insertBefore(item, feedEl.firstChild);

    // Keep max 50 items
    while (feedEl.children.length > 50) {
      feedEl.removeChild(feedEl.lastChild);
    }
  }
}

function showOnboardingComplete(msg) {
  document.getElementById('progress-fill').style.width = '100%';
  // Close any open live preview before switching steps
  closeLivePreview();

  // Build summary stats from the live tree
  const stats = { journal: 0, people: 0, patterns: 0, goals: 0, creative: 0, total: 0 };
  for (const p of liveTreePaths) {
    if (p.includes('/')) stats.total++;
    if (p.includes('record/journal/')) stats.journal++;
    if (p.includes('world/people/')) stats.people++;
    if (p.includes('understanding/patterns/')) stats.patterns++;
    if (p.includes('active/goals/')) stats.goals++;
    if (p.includes('record/creative/')) stats.creative++;
  }

  const statsEl = document.getElementById('completion-stats');
  const statItems = [
    { label: 'Journal entries', value: stats.journal },
    { label: 'People', value: stats.people },
    { label: 'Patterns', value: stats.patterns },
    { label: 'Goals', value: stats.goals },
    { label: 'Creative works', value: stats.creative },
    { label: 'Total files', value: stats.total },
  ].filter(s => s.value > 0);

  statsEl.innerHTML = statItems.map(s => `
    <div class="completion-stat">
      <span class="stat-value">${s.value}</span>
      <span class="stat-label">${s.label}</span>
    </div>
  `).join('');

  switchOnboardingStep(4);

  document.getElementById('onboarding-finish').addEventListener('click', () => {
    hideOnboarding();
    send({ type: 'list_conversations' });
    send({ type: 'file_tree' });
  });
}

function showOnboardingError(message) {
  const existing = document.querySelector('.onboarding-error');
  if (existing) existing.remove();

  const err = document.createElement('div');
  err.className = 'onboarding-error';
  err.textContent = message;

  const activeStep = document.querySelector('.onboarding-step.active');
  if (activeStep) activeStep.appendChild(err);
}

function hideOnboarding() {
  onboardingRequired = false;
  const overlay = document.getElementById('onboarding-overlay');
  if (overlay) {
    overlay.classList.add('fading');
    setTimeout(() => overlay.remove(), 400);
  }
}

// --- Profile Dropdown Toggle ---

document.getElementById('profile-switcher').addEventListener('click', (e) => {
  // Don't toggle if clicking inside the dropdown (input, buttons, items)
  if (e.target.closest('#profile-dropdown')) return;
  e.stopPropagation();
  toggleProfileDropdown();
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (profileDropdownOpen && !e.target.closest('#profile-switcher')) {
    toggleProfileDropdown(false);
  }
});

// --- Init ---

setupDragDrop();
connect();
