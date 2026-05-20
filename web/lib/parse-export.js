/**
 * Parse ChatGPT export data — extract user messages, build triage queue.
 *
 * Handles two ChatGPT export formats:
 * 1. Individual JSON files per conversation (newer format)
 * 2. Single conversations.json array (older format)
 */

/**
 * Walk a conversation's mapping tree to extract messages in order.
 * The mapping is a flat dict of nodes linked by parent/children refs.
 */
function walkMappingTree(mapping) {
  if (!mapping) return [];

  // Build children linkage from parent refs (some exports have empty children arrays)
  let rootId = null;
  for (const [id, node] of Object.entries(mapping)) {
    if (node.parent === null || node.parent === undefined) {
      rootId = id;
    } else if (mapping[node.parent]) {
      const parent = mapping[node.parent];
      if (!parent.children) parent.children = [];
      if (!parent.children.includes(id)) parent.children.push(id);
    }
  }

  if (!rootId) return [];

  const messages = [];

  function walk(nodeId) {
    const node = mapping[nodeId];
    if (!node) return;

    if (node.message && node.message.content && node.message.content.parts) {
      const parts = node.message.content.parts.filter(p => typeof p === 'string');
      const text = parts.join('\n').trim();
      if (text) {
        messages.push({
          role: node.message.author?.role || 'unknown',
          text,
          createTime: node.message.create_time || null,
        });
      }
    }

    const children = node.children || [];
    for (const childId of children) {
      walk(childId);
    }
  }

  walk(rootId);
  return messages;
}

/**
 * Parse a single conversation object into a normalized structure.
 */
function parseConversation(conv, sourceFilename) {
  const messages = walkMappingTree(conv.mapping);

  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');

  const userText = userMessages.map(m => m.text).join('\n\n');
  const fullText = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `[${m.role}]: ${m.text}`)
    .join('\n\n');

  return {
    id: conv.conversation_id || sourceFilename || crypto.randomUUID(),
    title: conv.title || 'Untitled',
    createTime: conv.create_time ? new Date(conv.create_time * 1000) : null,
    sourceFilename,
    userMessages,
    assistantMessages,
    userText,
    fullText,
    stats: {
      userMessageCount: userMessages.length,
      assistantMessageCount: assistantMessages.length,
      userCharCount: userText.length,
      avgUserMsgLength: userMessages.length > 0
        ? Math.round(userText.length / userMessages.length)
        : 0,
      hasCreativeContent: detectCreativeContent(userText),
    },
  };
}

/**
 * Detect if user messages contain creative/co-authored content
 * where assistant responses would be valuable to preserve.
 */
function detectCreativeContent(text) {
  if (!text) return false;

  // Poem-like patterns: short lines with line breaks
  const lines = text.split('\n').filter(l => l.trim());
  const shortLines = lines.filter(l => l.trim().length < 60);
  const hasStanzaPattern = shortLines.length > 5 && shortLines.length / lines.length > 0.6;

  // Explicit creative prompts — only actual co-authored creative output
  const creativePrompts = /\b(write me|write a|compose|poem|story|song|lyrics|verse|stanza|chapter)\b/i;
  const hasCreativePrompt = creativePrompts.test(text);

  return hasStanzaPattern || hasCreativePrompt;
}

/**
 * Parse all files from a ChatGPT export.
 * Handles both individual JSON files and conversations.json format.
 */
export function parseExportFiles(files) {
  const conversations = [];

  for (const file of files) {
    if (!file.name.endsWith('.json')) continue;

    let data;
    try {
      data = JSON.parse(file.content);
    } catch {
      continue;
    }

    // Single conversations.json (array of conversations)
    if (Array.isArray(data)) {
      for (const conv of data) {
        if (conv.mapping) {
          conversations.push(parseConversation(conv, file.name));
        }
      }
    }
    // Individual conversation file (has mapping property)
    else if (data.mapping) {
      conversations.push(parseConversation(data, file.name));
    }
    // Skip non-conversation files (model_comparisons.json, etc.)
  }

  return conversations;
}

/**
 * Heuristic pre-filters — skip conversations that are obviously not personal.
 * Returns { dominated: true, reason } or { dominated: false }.
 */
const PERSONAL_RE = /\b(I|I'm|I've|I'll|I'd|my|me|myself|mine)\b/;
const CODE_RE = /[{}\[\]<>\/;=]|function |const |var |import |class |def |return |if \(|for \(/g;

function heuristicSkip(userText, msgCount) {
  if (userText.length < 50) return { dominated: true, reason: 'too_short' };

  const codeMatches = (userText.match(CODE_RE) || []).length;
  const codeRatio = codeMatches / (userText.length / 50);
  if (codeRatio > 3 && userText.length > 100) return { dominated: true, reason: 'code_heavy' };

  if (!PERSONAL_RE.test(userText)) return { dominated: true, reason: 'no_personal' };

  if (msgCount === 1 && userText.length < 150) return { dominated: true, reason: 'single_short' };

  return { dominated: false };
}

/**
 * Build the triage queue: sorted, filtered, ready for Haiku summarization.
 * Returns { triageQueue, preSkipped, preSkipStats }.
 */
export function buildTriageQueue(conversations) {
  const nonEmpty = conversations
    .filter(c => c.stats.userMessageCount > 0 && c.stats.userCharCount > 10);

  const triageQueue = [];
  const preSkipped = [];
  const preSkipStats = { too_short: 0, code_heavy: 0, no_personal: 0, single_short: 0 };

  for (const c of nonEmpty) {
    const h = heuristicSkip(c.userText, c.stats.userMessageCount);
    if (h.dominated) {
      preSkipped.push(c);
      preSkipStats[h.reason]++;
    } else {
      triageQueue.push(c);
    }
  }

  // Sort newest first
  triageQueue.sort((a, b) => {
    if (!a.createTime && !b.createTime) return 0;
    if (!a.createTime) return 1;
    if (!b.createTime) return -1;
    return b.createTime - a.createTime;
  });

  return { triageQueue, preSkipped, preSkipStats };
}

/**
 * Prepare a conversation for Haiku summarization.
 * Returns a compact text representation with only user content.
 */
export function prepareForSummary(conversation) {
  // Take first ~2000 chars of user text for summary (enough for a one-liner)
  const preview = conversation.userText.slice(0, 2000);

  return {
    id: conversation.id,
    title: conversation.title,
    date: conversation.createTime ? conversation.createTime.toISOString().split('T')[0] : 'unknown',
    userPreview: preview,
    messageCount: conversation.stats.userMessageCount,
  };
}

/**
 * Prepare a conversation for full ingestion (Phase 2).
 * Returns user-only text, or full text for creative content.
 */
export function prepareForIngestion(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    date: conversation.createTime ? conversation.createTime.toISOString().split('T')[0] : 'unknown',
    // Include full exchange for creative content, user-only otherwise
    content: conversation.stats.hasCreativeContent
      ? conversation.fullText
      : conversation.userText,
    hasCreativeContent: conversation.stats.hasCreativeContent,
    messageCount: conversation.stats.userMessageCount,
  };
}
