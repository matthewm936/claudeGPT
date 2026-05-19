import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import * as profiles from './lib/profiles.js';
import * as conversations from './lib/conversations.js';
import * as fileTree from './lib/file-tree.js';
import * as claudeBridge from './lib/claude-bridge.js';
import * as importOrchestrator from './lib/import-orchestrator.js';
import * as collectionOrchestrator from './lib/collection-orchestrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..');
const PROFILES_DIR = path.join(REPO_DIR, 'profiles');
// Initialize modules
profiles.init(PROFILES_DIR);
fileTree.init(() => profiles.getDir(PROFILES_DIR));
if (profiles.getActive()) fileTree.setupWatcher();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// --- WebSocket Handler ---

wss.on('connection', (ws) => {
  fileTree.addClient(ws);
  ws.on('close', () => fileTree.removeClient(ws));

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case 'chat':
        claudeBridge.handleChat(ws, msg.conversationId, msg.text, REPO_DIR, profiles.getDir(PROFILES_DIR), msg.model);
        break;

      case 'new_conversation': {
        const pDir = profiles.getDir(PROFILES_DIR);
        if (!pDir) { ws.send(JSON.stringify({ type: 'error', message: 'No active profile' })); break; }
        const conv = conversations.create(pDir);
        ws.send(JSON.stringify({ type: 'conversation', data: conv }));
        break;
      }

      case 'list_conversations': {
        const pDir = profiles.getDir(PROFILES_DIR);
        if (!pDir) { ws.send(JSON.stringify({ type: 'conversations', list: [] })); break; }
        const list = conversations.list(pDir).map(c => ({ ...c, active: claudeBridge.isActive(c.id) }));
        ws.send(JSON.stringify({ type: 'conversations', list }));
        break;
      }

      case 'load_conversation': {
        const pDir = profiles.getDir(PROFILES_DIR);
        if (!pDir) { ws.send(JSON.stringify({ type: 'error', message: 'No active profile' })); break; }
        const conv = conversations.load(pDir, msg.conversationId);
        if (!conv) { ws.send(JSON.stringify({ type: 'error', message: 'Conversation not found' })); break; }
        const active = claudeBridge.isActive(msg.conversationId);
        ws.send(JSON.stringify({ type: 'conversation', data: conv, active }));
        // If conversation has a running process, rejoin the live stream
        if (active) {
          ws.send(JSON.stringify({ type: 'rejoin_start', conversationId: msg.conversationId }));
          claudeBridge.rejoin(ws, msg.conversationId);
        }
        break;
      }

      case 'delete_conversation': {
        const pDir = profiles.getDir(PROFILES_DIR);
        if (!pDir) { ws.send(JSON.stringify({ type: 'error', message: 'No active profile' })); break; }
        conversations.remove(pDir, msg.conversationId);
        ws.send(JSON.stringify({ type: 'conversation_deleted', conversationId: msg.conversationId }));
        break;
      }

      case 'file_tree':
        ws.send(JSON.stringify({ type: 'file_tree', tree: fileTree.build(profiles.getDir(PROFILES_DIR)) }));
        break;

      case 'read_file': {
        const userDir = profiles.getDir(PROFILES_DIR);
        if (!userDir) { ws.send(JSON.stringify({ type: 'error', message: 'No active profile' })); break; }
        const filePath = path.resolve(userDir, msg.path);
        const resolvedUserDir = path.resolve(userDir);
        if (!filePath.startsWith(resolvedUserDir)) { ws.send(JSON.stringify({ type: 'error', message: 'Invalid path' })); break; }
        try {
          ws.send(JSON.stringify({ type: 'file_content', path: msg.path, content: fs.readFileSync(filePath, 'utf-8') }));
        } catch (err) {
          console.error(`[read_file] failed: ${filePath} — ${err.message}`);
          ws.send(JSON.stringify({ type: 'error', message: `Cannot read ${msg.path}` }));
        }
        break;
      }

      case 'abort':
        claudeBridge.abort(msg.conversationId);
        break;

      case 'list_profiles':
        ws.send(JSON.stringify({ type: 'profiles', profiles: profiles.list(PROFILES_DIR), active: profiles.getActive() }));
        break;

      case 'create_profile':
        try {
          const name = profiles.create(msg.name, PROFILES_DIR);
          profiles.select(name, PROFILES_DIR);
          fileTree.setupWatcher();
          ws.send(JSON.stringify({ type: 'profile_selected', name, profiles: profiles.list(PROFILES_DIR) }));
        } catch (err) { ws.send(JSON.stringify({ type: 'error', message: err.message })); }
        break;

      case 'select_profile':
        try {
          profiles.select(msg.name, PROFILES_DIR);
          fileTree.setupWatcher();
          ws.send(JSON.stringify({ type: 'profile_selected', name: msg.name, profiles: profiles.list(PROFILES_DIR) }));
        } catch (err) { ws.send(JSON.stringify({ type: 'error', message: err.message })); }
        break;

      case 'rename_profile':
        try {
          const newName = profiles.rename(msg.oldName, msg.newName, PROFILES_DIR);
          fileTree.setupWatcher();
          ws.send(JSON.stringify({ type: 'profile_renamed', oldName: msg.oldName, newName, profiles: profiles.list(PROFILES_DIR), active: profiles.getActive() }));
        } catch (err) { ws.send(JSON.stringify({ type: 'error', message: err.message })); }
        break;

      case 'delete_profile':
        try {
          profiles.remove(msg.name, PROFILES_DIR);
          fileTree.setupWatcher();
          ws.send(JSON.stringify({ type: 'profile_deleted', profiles: profiles.list(PROFILES_DIR), active: profiles.getActive() }));
        } catch (err) { ws.send(JSON.stringify({ type: 'error', message: err.message })); }
        break;

      case 'check_onboarding': {
        const complete = profiles.isOnboardingComplete(PROFILES_DIR);
        const imported = profiles.isChatgptImported(PROFILES_DIR);
        if (complete) {
          ws.send(JSON.stringify({ type: 'onboarding_status', required: false, chatgptImported: imported }));
        } else {
          // Check for a resumable checkpoint
          const cp = importOrchestrator.checkForCheckpoint(PROFILES_DIR);
          if (cp && (cp.phase === 'triage_complete' || cp.phase === 'ingesting')) {
            ws.send(JSON.stringify({ type: 'onboarding_status', required: true, hasCheckpoint: true, checkpointPhase: cp.phase }));
          } else {
            ws.send(JSON.stringify({ type: 'onboarding_status', required: true }));
          }
        }
        break;
      }

      case 'skip_onboarding':
        profiles.markOnboardingComplete(PROFILES_DIR);
        ws.send(JSON.stringify({ type: 'onboarding_complete' }));
        break;

      case 'upload_chatgpt_export':
        try { await importOrchestrator.handleUploadExport(ws, msg.data, PROFILES_DIR); }
        catch (err) { ws.send(JSON.stringify({ type: 'import_error', message: `Failed to parse export: ${err.message}` })); }
        break;

      case 'triage_override':
        importOrchestrator.overrideDecision(msg.id, msg.decision);
        if (importOrchestrator.allAsksResolved()) {
          ws.send(JSON.stringify({ type: 'triage_ready' }));
        }
        break;

      case 'read_conversation': {
        const convData = importOrchestrator.getConversationText(msg.id);
        if (convData) ws.send(JSON.stringify({ type: 'conversation_text', ...convData }));
        break;
      }

      case 'resume_import':
        try { importOrchestrator.resumeFromCheckpoint(ws, PROFILES_DIR); }
        catch (err) { ws.send(JSON.stringify({ type: 'import_error', message: `Resume failed: ${err.message}` })); }
        break;

      case 'start_ingest':
        try { await importOrchestrator.startIngest(ws, PROFILES_DIR); }
        catch (err) { ws.send(JSON.stringify({ type: 'import_error', message: err.message })); }
        break;

      case 'abort_import':
        importOrchestrator.abort(ws);
        break;

      // --- Collections ---

      case 'create_collection':
        try { collectionOrchestrator.createCollection(ws, msg.metadata, PROFILES_DIR); }
        catch (err) { ws.send(JSON.stringify({ type: 'collection_error', message: err.message })); }
        break;

      case 'add_batch':
        try { collectionOrchestrator.addBatch(ws, msg.collectionId, msg.metadata, PROFILES_DIR); }
        catch (err) { ws.send(JSON.stringify({ type: 'collection_error', message: err.message })); }
        break;

      case 'upload_batch_start':
        try { collectionOrchestrator.handleUploadStart(ws, msg.collectionId, msg.batchSlug, PROFILES_DIR); }
        catch (err) { ws.send(JSON.stringify({ type: 'collection_error', message: err.message })); }
        break;

      case 'upload_batch_file':
        try { collectionOrchestrator.handleUploadFile(ws, msg.collectionId, msg.batchSlug, msg.fileIndex, msg.filename, msg.data, PROFILES_DIR); }
        catch (err) { ws.send(JSON.stringify({ type: 'collection_error', message: err.message })); }
        break;

      case 'upload_batch_complete':
        try { await collectionOrchestrator.handleUploadComplete(ws, msg.collectionId, msg.batchSlug, msg.totalFiles, PROFILES_DIR); }
        catch (err) { ws.send(JSON.stringify({ type: 'collection_error', message: err.message })); }
        break;

      case 'list_collections':
        ws.send(JSON.stringify({ type: 'collections_list', collections: collectionOrchestrator.listCollections(PROFILES_DIR) }));
        break;

      case 'get_collection':
        try {
          const coll = collectionOrchestrator.getCollection(msg.collectionId, PROFILES_DIR);
          ws.send(JSON.stringify({ type: 'collection_detail', ...coll }));
        } catch (err) { ws.send(JSON.stringify({ type: 'collection_error', message: err.message })); }
        break;

      case 'read_batch':
        try {
          const batch = collectionOrchestrator.getBatchContent(msg.collectionId, msg.batchSlug, PROFILES_DIR);
          ws.send(JSON.stringify({ type: 'batch_content', collectionId: msg.collectionId, ...batch }));
        } catch (err) { ws.send(JSON.stringify({ type: 'collection_error', message: err.message })); }
        break;

      case 'update_collection_metadata':
        try {
          collectionOrchestrator.updateCollectionMetadata(msg.collectionId, msg.updates, PROFILES_DIR);
          ws.send(JSON.stringify({ type: 'collection_metadata_updated', collectionId: msg.collectionId }));
        } catch (err) { ws.send(JSON.stringify({ type: 'collection_error', message: err.message })); }
        break;

      case 'update_collection_context':
        try {
          collectionOrchestrator.updateCollectionContextFile(msg.collectionId, msg.content, PROFILES_DIR);
          ws.send(JSON.stringify({ type: 'collection_context_updated', collectionId: msg.collectionId }));
        } catch (err) { ws.send(JSON.stringify({ type: 'collection_error', message: err.message })); }
        break;

      case 'update_batch_metadata':
        try {
          collectionOrchestrator.updateBatchMetadata(msg.collectionId, msg.batchSlug, msg.updates, PROFILES_DIR);
          ws.send(JSON.stringify({ type: 'batch_metadata_updated', collectionId: msg.collectionId, batchSlug: msg.batchSlug }));
        } catch (err) { ws.send(JSON.stringify({ type: 'collection_error', message: err.message })); }
        break;

      case 'resume_batch':
        try { await collectionOrchestrator.resumeBatch(ws, msg.collectionId, msg.batchSlug, PROFILES_DIR); }
        catch (err) { ws.send(JSON.stringify({ type: 'collection_error', message: err.message })); }
        break;

      case 'abort_collection':
        collectionOrchestrator.abort(ws);
        break;
    }
  });
});

const PORT = process.env.PORT || 3141;
server.listen(PORT, () => console.log(`YourPsyche running at http://localhost:${PORT}`));
