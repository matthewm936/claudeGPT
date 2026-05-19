import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

function convDir(profileDir) {
  const dir = path.join(profileDir, 'conversations');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function load(profileDir, id) {
  const file = path.join(convDir(profileDir), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export function save(profileDir, conv) {
  conv.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(convDir(profileDir), `${conv.id}.json`), JSON.stringify(conv, null, 2));
}

export function list(profileDir) {
  const dir = convDir(profileDir);
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    const conv = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    return { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, messageCount: conv.messages.length };
  }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function create(profileDir) {
  const conv = {
    id: uuidv4(),
    sessionId: null,
    title: 'New conversation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  save(profileDir, conv);
  return conv;
}

export function remove(profileDir, id) {
  const file = path.join(convDir(profileDir), `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
