import fs from 'fs';
import path from 'path';

const clients = new Set();
let fileWatcher = null;
let debounceTimer = null;
let getUserDir; // injected

export function init(getUserDirFn) {
  getUserDir = getUserDirFn;
}

export function addClient(ws) { clients.add(ws); }
export function removeClient(ws) { clients.delete(ws); }

export function build(dir, basePath = '') {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    })
    .map(e => ({
      name: e.name,
      path: path.join(basePath, e.name),
      type: e.isDirectory() ? 'directory' : 'file',
      children: e.isDirectory() ? build(path.join(dir, e.name), path.join(basePath, e.name)) : undefined,
    }));
}

export function getInboxItems(userDir) {
  const raw = path.join(userDir, 'data', 'inbox', 'raw');
  const processed = path.join(userDir, 'data', 'inbox', 'processed');
  const rawItems = fs.existsSync(raw)
    ? fs.readdirSync(raw).filter(f => !f.startsWith('.')).map(f => ({ name: f, status: 'pending' }))
    : [];
  const processedItems = fs.existsSync(processed)
    ? fs.readdirSync(processed).filter(f => !f.startsWith('.')).map(f => ({ name: f, status: 'processed' }))
    : [];
  return [...rawItems, ...processedItems];
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

export function broadcastTree() {
  broadcast({ type: 'file_tree_update', tree: build(getUserDir()) });
}

export function broadcastInbox() {
  const dir = getUserDir();
  if (dir) broadcast({ type: 'inbox_update', items: getInboxItems(dir) });
}

export function setupWatcher() {
  if (fileWatcher) { try { fileWatcher.close(); } catch {} }
  const dir = getUserDir();
  if (dir && fs.existsSync(dir)) {
    fileWatcher = fs.watch(dir, { recursive: true }, () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { broadcastTree(); broadcastInbox(); }, 500);
    });
  }
}
