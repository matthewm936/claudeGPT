/**
 * Prompt templates for the import pipeline.
 */

/**
 * Build the Haiku triage prompt for a batch of conversations.
 * AI decides keep/skip/ask based on whether each conversation
 * contains material that would fill the user's knowledge base.
 */
export function buildSummaryPrompt(conversations) {
  const items = conversations.map((c, i) => {
    const preview = c.userPreview.length > 1500
      ? c.userPreview.slice(0, 1500) + '...'
      : c.userPreview;
    return `${i + 1}. [Title: "${c.title}"] [Date: ${c.date}] [${c.messageCount} messages]\nUser messages:\n${preview}`;
  }).join('\n\n---\n\n');

  return `You are triaging a user's ChatGPT history for import into a personal knowledge base. The KB captures who this person is — their inner life, relationships, creative work, goals, patterns, and worldview.

For each conversation, decide: does it contain material that fills the KB?

Output EXACTLY one line per conversation:
NUMBER. DECISION CATEGORY | SUMMARY | REASON

DECISION:
- KEEP — Contains material about the person worth preserving
- SKIP — Purely transactional, nothing about the person
- ASK — Genuinely ambiguous. Use sparingly (<10% of total).

What the KB captures (KEEP these):
- Journal entries: venting, processing events, daily reflections, emotional states
- People: mentions of specific relationships, dynamics, history with someone
- Creative work: poems, stories, essays, songwriting, collaborative writing
- Dreams: descriptions, recurring themes, analysis
- Goals & decisions: aspirations, career direction, weighing life choices
- Self-examination: recurring behaviors, psychological patterns, personal growth
- Philosophy & worldview: beliefs, values, meaning-making, ethical positions
- Emotionally significant moments: vivid scenes, body sensations, memories
- Projects that matter to them: things they're building that reflect who they are

What to SKIP:
- Code debugging, API help, technical Q&A with no personal context
- Product research, price comparisons, factual lookups
- How-to questions, homework help, generic brainstorming
- Anything where the user is just using the AI as a tool, not sharing themselves

CATEGORY (for display — pick the best fit):
journal, person, creative, dream, reflection, goal, decision, project, philosophy, technical, research

Rules:
- One line per conversation, no extra text
- Summary: 8-15 words capturing what the user shared or explored
- REASON: required for ASK (one sentence explaining the ambiguity), optional for KEEP/SKIP
- When in doubt between skip and keep, lean KEEP
- Match the NUMBER to the input number

Conversations:

${items}`;
}

/**
 * Parse Haiku's triage response into structured results.
 */
export function parseSummaryResponse(responseText, originalConversations) {
  const lines = responseText.split('\n').filter(l => l.trim());
  const results = [];

  for (const line of lines) {
    // Match "1. KEEP journal | summary" or "1. ASK person | summary | reason"
    const match = line.match(/^(\d+)\.\s*(KEEP|SKIP|ASK)\s+(\w+)\s*\|\s*(.+?)(?:\s*\|\s*(.*))?$/i);
    if (!match) {
      // Fall back to old format: "1. category | summary"
      const oldMatch = line.match(/^(\d+)\.\s*(\w+)\s*[|:]\s*(.+)$/);
      if (oldMatch) {
        const index = parseInt(oldMatch[1]) - 1;
        const category = oldMatch[2].toLowerCase().trim();
        const summary = oldMatch[3].trim();
        const decision = category === 'skip' || category === 'technical' || category === 'research' ? 'skip' : 'keep';
        if (index >= 0 && index < originalConversations.length) {
          results.push({
            id: originalConversations[index].id,
            title: originalConversations[index].title,
            date: originalConversations[index].date,
            category, summary, decision, reason: '',
          });
        }
      }
      continue;
    }

    const index = parseInt(match[1]) - 1;
    const decision = match[2].toLowerCase().trim();
    const category = match[3].toLowerCase().trim();
    const summary = match[4].trim();
    const reason = (match[5] || '').trim();

    if (index >= 0 && index < originalConversations.length) {
      results.push({
        id: originalConversations[index].id,
        title: originalConversations[index].title,
        date: originalConversations[index].date,
        category, summary, decision, reason,
      });
    }
  }

  return results;
}

/**
 * Build the ingestion prompt for a batch of curated conversations.
 */
export function buildIngestionPrompt(conversations, batchIndex, totalBatches) {
  const blocks = conversations.map(c => {
    return `=== CONVERSATION: "${c.title}" [${c.date}] ===\n${c.hasCreativeContent ? '(includes AI responses — co-creative content)\n' : ''}\n${c.content}`;
  }).join('\n\n' + '='.repeat(60) + '\n\n');

  return `You are processing batch ${batchIndex + 1} of ${totalBatches} from a user's ChatGPT history.

These conversations have been curated for import. Your job is to PRESERVE what the user said, not to analyze or interpret it.

## The core rule: separate what the user said from what the AI said.

ChatGPT conversations contain two voices — the user's and ChatGPT's. The KB stores the USER's words, thoughts, and experiences. ChatGPT's analysis, frameworks, and observations are NOT the user's own — do not file them as if they are.

## What to create:

1. **Conversation records** → record/conversations/YYYY-MM-DD-slug.md
   - The PRIMARY output. Every kept conversation gets one.
   - Contains the user's actual words — what they typed, asked, vented, explored.
   - Strip ChatGPT's responses UNLESS it's co-creative work (poems, stories written together).
   - Preserve the user's voice, mess, uncertainty. Don't clean it up into a narrative.

2. **Creative work** → record/creative/{type}/YYYY-MM-DD-slug.md
   - When the user actually WROTE something (essay, poem, story, manifesto).
   - Preserve it VERBATIM. This is their writing, not a summary of it.
   - Include AI co-authored portions only when it's collaborative creative work.

3. **People mentioned** → world/people/name.md
   - FACTS the user stated about someone. Relationship, history, dynamics.
   - Do NOT include ChatGPT's analysis of the relationship.

4. **Goals & decisions** → active/goals/ or active/decisions/
   - Only when the user STATED a goal or is ACTIVELY weighing a decision.
   - If they were just researching something or asking about it, that's a conversation record, not a goal.

5. **Dreams** → record/dreams/YYYY-MM-DD.md
   - The user's description of the dream only. Not interpretation.

6. **Moments** → record/moments/YYYY-MM-DD-slug.md
   - Emotionally vivid snapshots — the user describing what something felt like.

## What NOT to create:

- **Do NOT create journal entries from conversations.** A conversation is not a journal. If the user didn't sit down to reflect, don't manufacture a reflection.
- **Do NOT create insight or pattern files.** Observations like "the deeper move here is..." are AI analysis. The understanding/ layer is built from direct conversation with the user over time, not inferred from imports.
- **Do NOT summarize or narrativize.** Don't turn a messy back-and-forth into a clean story. The mess IS the data.
- **Do NOT attribute ChatGPT's observations to the user.** If ChatGPT said "you're engineering your environment" and the user didn't say that themselves, it doesn't go in the KB as the user's insight.

## Front matter format:

Every file must include:
\`\`\`
---
date: YYYY-MM-DD
source: chatgpt-import
type: conversation | creative | goal | decision | person | dream | moment
tags: [relevant, tags]
---
\`\`\`

## File path rules:
- All paths are RELATIVE to the current directory. Write to record/, world/, active/, etc. directly.
- Do NOT use absolute paths. Do NOT write to profiles/ or user/.
- Use dates from the conversation data for filenames (YYYY-MM-DD format).
- Merge related content (same person across conversations → one people file).

CONVERSATIONS TO PROCESS:

${blocks}`;
}

/**
 * Build the synthesis prompt for the final dedup/merge pass.
 */
export function buildSynthesisPrompt(totalBatches) {
  return `You have processed a user's ChatGPT export across ${totalBatches} parallel workers.
The KB exists in the current directory. Your tasks:

1. Read the full file tree to see everything that was created
2. MERGE DUPLICATES: Multiple workers may have created files for the same person, topic, or event.
   - People files: merge into single definitive file per person
   - Conversation records: merge same-date entries if they cover the same conversation
   - Creative work: deduplicate, keeping the complete version

DO NOT create now.md, timeline.md, or any understanding/ files (psyche.md, summary.md, patterns/). All of these are built through direct conversation with the user over time, not inferred from imports. Import data provides raw material only.

After merging, delete any redundant duplicate files.

All paths are RELATIVE to the current directory. Do NOT use absolute paths or write to profiles/ or user/.`;
}
