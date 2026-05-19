/**
 * Prompt templates for collection processing —
 * image transcription, assembly, synthesis, and context generation.
 */

/**
 * Build prompt for transcribing a batch of images (handwritten pages, photos, etc).
 * Claude will Read each image and Write a transcript file.
 */
export function buildImageTranscriptionPrompt(pages, manifest, previousContext, knownTerms) {
  const pageList = pages.map(p => `- File ${p.number}: Read the file at "${p.imagePath}"`).join('\n');

  const termsBlock = knownTerms?.length > 0
    ? `\nKNOWN NAMES AND TERMS (from the person's life — use these to disambiguate unclear handwriting):\n${knownTerms.join(', ')}\nWhen handwriting is ambiguous between a known term above and an unknown word, prefer the known term.\n`
    : '';

  return `You are transcribing images from a personal collection.

ABOUT THIS COLLECTION:
Collection: ${manifest.name}
Batch: ${manifest.batchName || manifest.name}
Timeline: ${manifest.timeline || 'Not specified'}
Description: ${manifest.description || 'No description provided'}
Physical: ${manifest.physicalDescription || 'No physical description provided'}
Life stage: ${manifest.lifeStage || 'Not specified'}
${termsBlock}
${previousContext ? `CONTEXT FROM PREVIOUS FILES (for continuity):\n${previousContext}\n` : 'This is the first batch of files.'}

INSTRUCTIONS:
For each file listed below, use the Read tool to view the image, then use the Write tool to save the transcript.

1. Transcribe the handwriting faithfully. Preserve intentional line breaks (poetry, lists, paragraph breaks). Normalize obvious misspellings only if clearly unintentional, but preserve the writer's voice — do not formalize grammar or restructure sentences.

2. UNCLEAR HANDWRITING: Mark uncertain words with [?word]. If two plausible readings exist, use [?word1/word2]. Reserve [illegible] only when you truly cannot guess.

3. DATE DETECTION: If the page has a date written on it (any format), record it in the front matter with date_source: explicit. If no date is visible, set has_date: false and leave date empty.

4. Note non-text content:
   - Drawings/diagrams: [drawing: description]
   - Crossed-out text: [crossed out: text] or [crossed out: illegible]
   - Margin notes: [margin: text]
   - Inserted items: [insert: description]

5. Write each transcript to the transcripts/ directory.

6. Front matter format:
---
page: NNN
date: YYYY-MM-DD (only if date_source is explicit, otherwise empty string)
date_source: explicit|none
date_confidence: high|low
has_date: true|false
---

FILES TO TRANSCRIBE:
${pageList}

Process each file in order. After reading each image, write its transcript immediately before moving to the next.`;
}

/**
 * Build prompt for assembling all transcripts into a single readable document.
 */
export function buildAssemblyPrompt(collectionManifest, batchManifest) {
  const name = batchManifest.name || collectionManifest.name;
  const timeline = batchManifest.timeline || collectionManifest.timeline || 'undated';
  const fileCount = batchManifest.fileCount || 0;

  return `You are assembling a readable document from individual transcripts in a collection.

ABOUT THIS BATCH:
Collection: ${collectionManifest.name}
Batch: ${name}
Timeline: ${timeline}
Files: ${fileCount}

INSTRUCTIONS:
1. Use Glob to find all files matching "transcripts/*.md"
2. Read each transcript file in order (alphabetical by filename)
3. Write a single file called "full-text.md" that combines all transcripts

FORMAT RULES for full-text.md:
- Start with: # ${name}
- Below the title: *${timeline}*
- Then a horizontal rule (---)
- Each source gets a section header with its date if known
  - Explicit dates: formatted nicely (e.g., "March 14, 2014")
  - Interpolated dates: with ~ prefix (e.g., "~April 2014")
  - No date: "undated"
- Between each section, add a horizontal rule (---)
- Include the full text exactly as transcribed
- Do NOT add AI commentary, analysis, or interpretation
- Do NOT summarize — include everything
- Preserve the original voice and formatting`;
}

/**
 * Build the synthesis prompt — the core of the collection system.
 * Claude reads collection content and updates KB synthesis layers.
 * Content stays in the collection; only understanding is extracted.
 */
export function buildSynthesisPrompt(collectionManifest, batchManifest) {
  const batchPath = `collections/${collectionManifest.slug}/batches/${batchManifest.slug}`;

  return `You are processing content from a personal collection into the knowledge base.

COLLECTION: ${collectionManifest.name}
BATCH: ${batchManifest.name}
TIMELINE: ${batchManifest.timeline || 'Not specified'}
LIFE STAGE: ${batchManifest.lifeStage || 'Not specified'}
DESCRIPTION: ${collectionManifest.description || ''} ${batchManifest.description || ''}

INSTRUCTIONS:

1. Read "${batchPath}/full-text.md" (or if it doesn't exist, Glob and read all files in "${batchPath}/transcripts/")

2. SYNTHESIZE — do not copy. The content stays in the collection. Your job is to update the user's synthesized knowledge:

   READ existing files before updating (use Glob + Read) to avoid duplicating known insights.

   UPDATE these layers based on what you find:
   - understanding/psyche.md — psychological architecture visible in the content
   - understanding/patterns/ — recurring behaviors (create slug.md, update index.md if it exists)
   - understanding/insights/ — conclusions worth preserving (create slug.md, update index.md if it exists)
   - understanding/personality.md — personality data points
   - understanding/body.md — embodied/physical descriptions, how emotions feel in the body
   - understanding/memory-map.md — memories that recur or seem significant
   - world/people/{name}.md — anyone mentioned with relational context
   - world/projects/{slug}.md — projects or creative endeavors
   - world/influences/ — books, media, figures referenced
   - active/goals/ — goals or aspirations expressed
   - now.md — ONLY if this content reflects CURRENT state (very recent content)

   DO NOT:
   - Create files in conversations/ or record/
   - Copy or move content out of the collection
   - Create journal entries, dream files, or moment files — the collection IS the record
   - Duplicate content that already exists in the KB

3. After synthesis, write the collection context file:
   Write to "collections/${collectionManifest.slug}/context.md":

   # ${collectionManifest.name}
   ${collectionManifest.description || '(no description)'}

   ## Batches
   - **${batchManifest.name}**: ${batchManifest.description || batchManifest.timeline || 'no context'} (${batchManifest.fileCount} files)

   ## Themes
   [List the major patterns, emotional threads, people, topics, and time periods found in this collection. Be specific.]

   ## Reference When
   [List specific scenarios when Claude should dig into this collection. Examples: "when user mentions [person name]", "when discussing [specific time period]", "when exploring [specific pattern or theme]". Be concrete, not generic.]

4. Write batch-level context:
   Write to "${batchPath}/context.md":

   # ${batchManifest.name}
   ${batchManifest.timeline || ''} ${batchManifest.description || ''}

   ## Content Summary
   [What this batch contains — key themes, notable entries, emotional weight]

   ## Key References
   [Specific people, events, places, dates mentioned — for searchability]

RULES:
- Use the user's language in synthesis, not clinical terms
- Be selective: not everything deserves a synthesis entry. Only file what has KB value.
- For people: check if world/people/{name}.md exists. If yes, Edit to append with a note about the source collection. If no, create it.
- For patterns: compare against existing understanding/patterns/ — extend existing patterns rather than creating duplicates.
- Create directories as needed (use Bash mkdir -p).`;
}

/**
 * Build prompt for updating a collection's context.md after adding new batches.
 */
export function buildContextUpdatePrompt(collectionManifest, batchManifests) {
  const batchList = batchManifests
    .map(b => `- "${b.name}" (${b.fileCount} files, ${b.timeline || 'undated'}): ${b.description || 'no description'}`)
    .join('\n');

  return `Update the context file for a collection that has new batches.

COLLECTION: ${collectionManifest.name}
DESCRIPTION: ${collectionManifest.description || ''}

BATCHES:
${batchList}

Read "collections/${collectionManifest.slug}/context.md" if it exists, then read each batch's context.md.
Write an updated "collections/${collectionManifest.slug}/context.md" that synthesizes all batches:

# ${collectionManifest.name}
${collectionManifest.description || ''}

## Batches
[One line per batch with name, timeline, file count, brief description]

## Themes
[Synthesized across ALL batches — major patterns, people, topics, time periods]

## Reference When
[Specific triggers for when to dig into this collection during conversation]`;
}
