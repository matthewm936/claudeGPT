/**
 * Prompt templates for artifact ingestion —
 * transcription, assembly, and KB filing.
 */

/**
 * Build prompt for transcribing a batch of handwritten pages from a physical notebook.
 * Claude will Read each page image and Write a transcript file.
 */
export function buildTranscriptionPrompt(pages, manifest, previousContext) {
  const pageList = pages.map(p => `- Page ${p.number}: Read the file at "${p.imagePath}"`).join('\n');

  return `You are transcribing handwritten pages from a physical notebook.

ABOUT THIS NOTEBOOK:
Name: ${manifest.name}
Timeline: ${manifest.timeline || 'Not specified'}
Description: ${manifest.description || 'No description provided'}
Physical: ${manifest.physicalDescription || 'No physical description provided'}
Life stage: ${manifest.lifeStage || 'Not specified'}

${previousContext ? `CONTEXT FROM PREVIOUS PAGES (for continuity — do not re-transcribe these):\n${previousContext}\n` : 'This is the first batch of pages.'}

INSTRUCTIONS:
For each page listed below, use the Read tool to view the image, then use the Write tool to save the transcript.

1. Transcribe the handwriting faithfully. Preserve intentional line breaks (poetry, lists, paragraph breaks). Normalize obvious misspellings only if clearly unintentional, but preserve the writer's voice — do not formalize grammar or restructure sentences.

2. DATE DETECTION: If the page has a date written on it (any format — "March 14", "3/14/08", "Tuesday the 5th", etc.), record it in the front matter with date_source: explicit. If no date is visible, set has_date: false and leave date empty — date inference happens later.

3. Note any non-text content:
   - Drawings or diagrams: describe as [drawing: description]
   - Math, equations, calculations: transcribe as-is, preserve layout
   - Crossed-out text: note as [crossed out: text] if legible, or [crossed out: illegible]
   - Illegible words: mark as [illegible]
   - Margin notes: prefix with [margin:]
   - Inserted items (ticket stubs, photos taped in): describe as [insert: description]
   - Lists (grocery, todo, etc.): preserve as bullet points

4. Write each transcript to the transcripts/ directory with the same page number.

5. Front matter format for each transcript file:
---
page: NNN
date: YYYY-MM-DD (only if date_source is explicit, otherwise leave empty string)
date_source: explicit (only if a date is clearly written on the page)
date_confidence: high
has_date: true/false
---

If no date is found on the page:
---
page: NNN
date: ""
date_source: none
date_confidence: low
has_date: false
---

PAGES TO TRANSCRIBE (use Read tool on each path, then Write the transcript):
${pageList}

Process each page in order. After reading each image, write its transcript immediately before moving to the next page.`;
}

/**
 * Build prompt for assembling all page transcripts into a single readable document.
 */
export function buildAssemblyPrompt(manifest) {
  return `You are assembling a digital copy of a physical notebook from individual page transcripts.

ABOUT THIS NOTEBOOK:
Name: ${manifest.name}
Timeline: ${manifest.timeline || 'Not specified'}
Pages: ${manifest.pageCount}

INSTRUCTIONS:
1. Use Glob to find all files matching "transcripts/page-*.md"
2. Read each transcript file in page-number order
3. Write a single file called "full-text.md" that combines all pages

FORMAT RULES for full-text.md:
- Start with a title: # ${manifest.name}
- Below the title: *${manifest.timeline || 'undated'}*
- Then a horizontal rule (---)
- Each page gets a section: ## Page N — [date if known, otherwise "undated"]
  - If the page has date_source: explicit, show the date formatted nicely (e.g., "March 14, 2014")
  - If the page has date_source: interpolated, show with ~ prefix (e.g., "~April 2014")
  - If no date at all, show "undated"
- Between each page section, add a horizontal rule (---)
- Include the full transcribed text exactly as it appears in the transcript
- Do NOT add any AI commentary, observations, analysis, or interpretation
- Do NOT summarize or condense — include everything
- Preserve the writer's exact voice and formatting

The reader should be able to sit down and read this like the original notebook.`;
}

/**
 * Build prompt for filing notebook content into the KB.
 */
export function buildKbFilingPrompt(manifest) {
  return `You have a transcribed physical notebook to file into the knowledge base.

ABOUT THIS NOTEBOOK:
Name: ${manifest.name}
Slug: ${manifest.slug}
Timeline: ${manifest.timeline || 'Not specified'}
Description: ${manifest.description || 'No description provided'}
Life stage: ${manifest.lifeStage || 'Not specified'}
${manifest.reviewNotes ? `Additional context from user: ${manifest.reviewNotes}` : ''}

INSTRUCTIONS:
1. Read "data/artifacts/notebooks/${manifest.slug}/full-text.md" — the complete transcribed notebook
2. File the content into the KB following these rules:

RECOGNIZE AND ROUTE EACH TYPE OF CONTENT:
A notebook can contain anything. Read each page and identify what it is, then file it in the right place:

- Journal entries (reflections, processing, "dear diary" style) → record/journal/YYYY-MM-DD.md
- Dreams (surreal imagery, "I dreamed", hastily scrawled before forgetting) → record/dreams/YYYY-MM-DD.md
- People mentions (anyone named with relational context) → world/people/firstname.md
- Emotionally vivid passages, turning points → record/moments/YYYY-MM-DD-slug.md
- Creative work (poems, stories, lyrics, essays) → record/creative/poetry/ or record/creative/writing/
- Project notes, ideas, brainstorms → world/projects/slug.md (if a coherent project) or skip (if just scratch)
- Lists (grocery, todo, packing) → skip filing (the full-text.md preserves them)
- Math, calculations, homework → skip filing (the full-text.md preserves them)
- Random notes that don't fit a category → skip filing (the full-text.md preserves them)

Not everything needs to be filed. The full-text.md is the complete record. Only file content that has KB value — personal reflection, relationships, creative work, dreams, significant moments. Mundane notes, calculations, and lists stay in the notebook only.

If multiple pages share a date, merge them into one entry per destination. If a page has no date, skip it for dated filing.

FRONT MATTER for all created files must include:
---
date: YYYY-MM-DD
source: artifact-notebook
artifact: ${manifest.slug}
---

RULES:
- Preserve the texture of handwritten language. Do not formalize, clean up grammar, or make it sound polished.
- This is RAW RECORD, not synthesis. Do NOT create understanding/ files, insights, or patterns.
- Do NOT create now.md or timeline.md entries — those are maintained separately.
- Preserve the original voice. These are the user's words from years ago.
- Check if files exist before writing (use Glob) — append rather than overwrite if a date already has an entry.
- If a file for world/people/name.md already exists, use Edit to add information; don't overwrite.
- Create directories as needed (use Bash mkdir -p).

Read the full text first to understand the scope, then file systematically.`;
}
