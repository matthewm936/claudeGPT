import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

let convDir;

export function init(dir) {
  convDir = dir;
  fs.mkdirSync(convDir, { recursive: true });
}

export function load(id) {
  const file = path.join(convDir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export function save(conv) {
  conv.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(convDir, `${conv.id}.json`), JSON.stringify(conv, null, 2));
}

export function list() {
  return fs.readdirSync(convDir).filter(f => f.endsWith('.json')).map(f => {
    const conv = JSON.parse(fs.readFileSync(path.join(convDir, f), 'utf-8'));
    return { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, messageCount: conv.messages.length };
  }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function create() {
  const conv = {
    id: uuidv4(),
    sessionId: null,
    title: 'New conversation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  save(conv);
  return conv;
}

export function remove(id) {
  const file = path.join(convDir, `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
