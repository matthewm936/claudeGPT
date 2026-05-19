import { state, dom } from './state.js';
import { send } from './ws.js';
import { escapeHtml } from './utils.js';
import { renderConversationList, loadConversationUI } from './conversations.js';
import { handleStreamChunk, handleStreamReset, addToolAction, finishStreaming, appendError, startRejoinStream } from './chat.js';
import { renderFileTree, openFileTab } from './explorer.js';
import { showProfilePicker, handleProfileSelected, handleProfileDeleted, handleProfileRenamed } from './profiles.js';
import { showOnboarding, hideOnboarding, resumeFromCheckpoint, updateParsed, updateProgress, addTriageReading, addTriageItem, onTriageComplete, onTriageReady, showConversationText, addLiveFileCreated, addToolActivity, showComplete, showError } from './onboarding.js';
import { onCollectionCreated, onBatchCreated, handleProgress as collectionProgress, handleFileProcessed as collectionFileProcessed, handleSynthesisUpdate, handleComplete as collectionComplete, handleToolActivity as collectionToolActivity, handleError as collectionError } from './collections.js';
import { renderCollectionList, renderImportItem } from './collection-browser.js';
import { openCollectionViewer, loadBatchIntoViewer, isViewerOpen } from './collection-viewer.js';

export function handleMessage(msg) {
  switch (msg.type) {
    case 'conversations': renderConversationList(msg.list); break;
    case 'conversation': loadConversationUI(msg.data); break;
    case 'rejoin_start': startRejoinStream(); break;
    case 'stream': handleStreamChunk(msg.text); break;
    case 'stream_reset': handleStreamReset(msg.text); break;
    case 'tool_use': addToolAction(msg.tool, msg.detail); break;
    case 'response_complete': finishStreaming(msg.costUsd, msg.finalText); send({ type: 'list_conversations' }); break;
    case 'error': appendError(msg.message); finishStreaming(); break;
    case 'file_tree': case 'file_tree_update': renderFileTree(msg.tree); break;

    case 'file_content': {
      const livePreview = document.getElementById('live-preview');
      if (livePreview && !livePreview.classList.contains('hidden')) {
        const contentEl = document.getElementById('live-preview-content');
        if (contentEl) contentEl.innerHTML = msg.path.endsWith('.md') ? marked.parse(msg.content) : `<pre><code>${escapeHtml(msg.content)}</code></pre>`;
      } else { openFileTab(msg.path, msg.content); }
      break;
    }

    case 'conversation_deleted':
      if (msg.conversationId === state.currentConversationId) { state.currentConversationId = null; dom.messages.innerHTML = ''; }
      send({ type: 'list_conversations' });
      break;

    // Profiles
    case 'profiles': showProfilePicker(msg.profiles, msg.active); break;
    case 'profile_selected': handleProfileSelected(msg); break;
    case 'profile_deleted': handleProfileDeleted(msg); break;
    case 'profile_renamed': handleProfileRenamed(msg); break;

    // Onboarding
    case 'onboarding_status':
      if (msg.required) {
        state.chatgptImported = false;
        renderImportItem();
        // If there's an in-progress import, resume it
        if (msg.hasCheckpoint) { showOnboarding(); send({ type: 'resume_import' }); }
        // Otherwise show main UI with welcome guide + import item
        else { send({ type: 'list_conversations' }); send({ type: 'file_tree' }); send({ type: 'list_collections' }); }
      }
      else { state.chatgptImported = !!msg.chatgptImported; renderImportItem(); hideOnboarding(); send({ type: 'list_conversations' }); send({ type: 'file_tree' }); send({ type: 'list_collections' }); }
      break;
    case 'import_checkpoint': resumeFromCheckpoint(msg); break;
    case 'import_parsed': updateParsed(msg); break;
    case 'import_progress': updateProgress(msg); break;
    case 'triage_reading': addTriageReading(msg); break;
    case 'triage_item': addTriageItem(msg); break;
    case 'triage_complete': onTriageComplete(msg); break;
    case 'triage_ready': onTriageReady(); break;
    case 'conversation_text': showConversationText(msg); break;
    case 'import_file_created': addLiveFileCreated(msg); break;
    case 'import_complete': showComplete(msg); break;
    case 'import_error': showError(msg.message); break;
    case 'import_aborted': showError('Import cancelled.'); break;
    case 'onboarding_complete': state.chatgptImported = true; renderImportItem(); hideOnboarding(); send({ type: 'list_conversations' }); send({ type: 'file_tree' }); send({ type: 'list_collections' }); break;

    case 'import_tool_activity': addToolActivity(msg); break;
    // No-ops
    case 'ingest_batch_complete': break;

    // Collections
    case 'collection_created': onCollectionCreated(msg); break;
    case 'batch_created': onBatchCreated(msg); break;
    case 'batch_upload_started': break;
    case 'batch_file_received': break;
    case 'batch_processing': collectionProgress(msg); break;
    case 'collection_progress': collectionProgress(msg); break;
    case 'collection_file_processed': collectionFileProcessed(msg); break;
    case 'collection_phase_complete': collectionProgress(msg); break;
    case 'collection_file_created': collectionFileProcessed(msg); break;
    case 'collection_synthesis_update': handleSynthesisUpdate(msg); break;
    case 'collection_tool_activity': collectionToolActivity(msg); break;
    case 'collection_complete': collectionComplete(msg); send({ type: 'list_collections' }); send({ type: 'file_tree' }); break;
    case 'collection_error': collectionError(msg); break;
    case 'collection_aborted': collectionError({ message: 'Processing cancelled.' }); break;
    case 'collections_list': renderCollectionList(msg.collections); break;
    case 'collection_detail': openCollectionViewer(msg); break;
    case 'batch_content': if (isViewerOpen()) loadBatchIntoViewer(msg); break;
    case 'collection_context_updated': break;
  }
}
