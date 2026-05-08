import { state, dom } from './state.js';
import { send } from './ws.js';
import { escapeHtml } from './utils.js';

export function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  updateGridLayout();
}

export function toggleExplorer() {
  state.explorerCollapsed = !state.explorerCollapsed;
  updateGridLayout();
}

function updateGridLayout() {
  const left = state.sidebarCollapsed ? '0px' : '260px';
  const right = state.explorerCollapsed ? '0px' : '300px';
  dom.app.style.gridTemplateColumns = `${left} 1fr ${right}`;
  dom.sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
  dom.explorerPanel.classList.toggle('collapsed', state.explorerCollapsed);
}

export function renderFileTree(tree) {
  dom.fileTree.innerHTML = '';
  tree.forEach(node => dom.fileTree.appendChild(createTreeNode(node, 0)));
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
    item.addEventListener('click', () => send({ type: 'read_file', path: node.path }));
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

export function openFileTab(filePath, content, displayName) {
  const existing = state.openTabs.find(t => t.path === filePath);
  if (existing) { existing.content = content; if (displayName) existing.displayName = displayName; }
  else state.openTabs.push({ path: filePath, content, displayName });
  state.activeTabPath = filePath;
  if (state.explorerCollapsed) toggleExplorer();
  renderTabs();
  renderFileContent(content, filePath);
}

export function closeTab(filePath) {
  state.openTabs = state.openTabs.filter(t => t.path !== filePath);
  if (state.activeTabPath === filePath) {
    state.activeTabPath = state.openTabs.length > 0 ? state.openTabs[state.openTabs.length - 1].path : null;
  }
  renderTabs();
  if (state.activeTabPath) {
    const tab = state.openTabs.find(t => t.path === state.activeTabPath);
    if (tab) renderFileContent(tab.content, tab.path);
  } else { dom.fileViewer.classList.add('hidden'); }
}

function renderTabs() {
  dom.fileTabs.innerHTML = state.openTabs.map(t => {
    const name = t.displayName || t.path.split('/').pop();
    return `<div class="file-tab ${t.path === state.activeTabPath ? 'active' : ''}" data-path="${t.path}">
      <span class="tab-name">${escapeHtml(name)}</span>
      <span class="tab-close" data-close="${t.path}">&times;</span>
    </div>`;
  }).join('');

  dom.fileTabs.querySelectorAll('.file-tab').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) { closeTab(e.target.dataset.close); return; }
      const p = el.dataset.path;
      state.activeTabPath = p;
      renderTabs();
      const tab = state.openTabs.find(t => t.path === p);
      if (tab) renderFileContent(tab.content, tab.path);
    });
  });
}

function renderFileContent(content, filePath) {
  dom.fileViewer.classList.remove('hidden');
  const isMarkdown = filePath.endsWith('.md') || filePath.startsWith('artifact:');
  dom.fileViewer.innerHTML = isMarkdown
    ? `<div class="markdown-content">${marked.parse(content)}</div>`
    : `<pre><code>${escapeHtml(content)}</code></pre>`;
}

export function updateInbox(items) {
  const pending = items.filter(i => i.status === 'pending');
  if (pending.length > 0) { dom.inboxBadge.classList.remove('hidden'); dom.inboxCount.textContent = pending.length; }
  else { dom.inboxBadge.classList.add('hidden'); }
}

export function setupDragDrop() {
  const chatPanel = document.getElementById('chat-panel');
  let dragCounter = 0;

  chatPanel.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; dom.dropOverlay.classList.remove('hidden'); });
  chatPanel.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter === 0) dom.dropOverlay.classList.add('hidden'); });
  chatPanel.addEventListener('dragover', (e) => e.preventDefault());
  chatPanel.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dom.dropOverlay.classList.add('hidden');
    for (const file of e.dataTransfer.files) {
      const reader = new FileReader();
      reader.onload = () => send({ type: 'upload', filename: file.name, data: reader.result.split(',')[1] });
      reader.readAsDataURL(file);
    }
  });
}
