import { state, dom } from './state.js';
import { send } from './ws.js';
import { escapeHtml } from './utils.js';
import { renderConversationList, loadConversationUI } from './conversations.js';
import { handleStreamChunk, handleStreamReset, addToolAction, finishStreaming, appendError, startRejoinStream } from './chat.js';
import { renderFileTree, openFileTab, updateInbox } from './explorer.js';
import { showProfilePicker, handleProfileSelected, handleProfileDeleted } from './profiles.js';
import { showOnboarding, hideOnboarding, resumeFromCheckpoint, updateParsed, updateProgress, addTriageReading, addTriageItem, onTriageComplete, onTriageReady, showConversationText, addLiveFileCreated, addToolActivity, showComplete, showError } from './onboarding.js';
import { onUploadStarted, handleProgress as artifactProgress, handlePageTranscribed, handleAnchorDate, handleFileCreated as artifactFileCreated, handleToolActivity as artifactToolActivity, handleComplete as artifactComplete, handleError as artifactError } from './artifacts.js';
import { renderArtifactList, showDigitalJournal } from './artifact-browser.js';

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

    case 'inbox_update': updateInbox(msg.items); break;
    case 'conversation_deleted':
      if (msg.conversationId === state.currentConversationId) { state.currentConversationId = null; dom.messages.innerHTML = ''; }
      send({ type: 'list_conversations' });
      break;

    // Profiles
    case 'profiles': showProfilePicker(msg.profiles, msg.active); break;
    case 'profile_selected': handleProfileSelected(msg); break;
    case 'profile_deleted': handleProfileDeleted(msg); break;

    // Onboarding
    case 'onboarding_status':
      if (msg.required) {
        showOnboarding();
        if (msg.hasCheckpoint) send({ type: 'resume_import' });
      }
      else { hideOnboarding(); send({ type: 'list_conversations' }); send({ type: 'file_tree' }); }
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
    case 'onboarding_complete': hideOnboarding(); send({ type: 'list_conversations' }); send({ type: 'file_tree' }); break;

    case 'import_tool_activity': addToolActivity(msg); break;
    // No-ops
    case 'ingest_batch_complete': break;

    // Artifacts
    case 'artifact_upload_started': onUploadStarted(msg); break;
    case 'artifact_uploaded': break; // handled internally — pipeline starts automatically
    case 'artifact_page_received': break; // upload progress tracked client-side
    case 'artifact_progress': artifactProgress(msg); break;
    case 'artifact_page_transcribed': handlePageTranscribed(msg); break;
    case 'artifact_anchor_date': handleAnchorDate(msg); break;
    case 'artifact_phase_complete': artifactProgress(msg); break;
    case 'artifact_file_created': artifactFileCreated(msg); break;
    case 'artifact_tool_activity': artifactToolActivity(msg); break;
    case 'artifact_complete': artifactComplete(msg); send({ type: 'list_artifacts' }); send({ type: 'file_tree' }); break;
    case 'artifact_error': artifactError(msg); break;
    case 'artifact_aborted': artifactError({ message: 'Processing cancelled.' }); break;
    case 'artifacts_list': renderArtifactList(msg.artifacts); break;
    case 'artifact_content': showDigitalJournal(msg); break;
  }
}
