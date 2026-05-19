# YourPsyche — Dev Guide

`CLAUDE.md` at repo root is the system prompt — it governs how Claude Code behaves as a personal AI. It's the core of the project.

## Repo Structure

```
CLAUDE.md                → System prompt + prompt design rules (THE product)
README.md                → Project overview and setup
search/                  → Semantic search tooling
  kb-search              → Bash wrapper (self-bootstrapping)
  search.py              → Embedding search implementation
  requirements.txt       → Python dependencies
profiles/                → Per-user KB directories (gitignored)
.active-profile          → Active profile name (gitignored)
.claude/CLAUDE.md        → This file (dev guide)
.claude/settings.json    → Pre-configured permissions for Claude Code
.venv/                   → Python venv for search (gitignored, auto-created)
.search-index.json       → Embedding index (gitignored, auto-built)
```

## How It Works

User clones the repo, opens it in VS Code with Claude Code, and starts talking. Claude reads `CLAUDE.md`, recognizes what kind of input the user provides, and builds the knowledge base dynamically. All KB paths in `CLAUDE.md` are relative — the system sets the working directory to the active profile (`profiles/<name>/`).

Profile data is gitignored — personal data never leaves the user's machine. `.active-profile` at repo root declares which profile is active. The web UI handles profile switching.

## Semantic Search

`search/kb-search` is self-bootstrapping. First run creates a Python venv and installs dependencies automatically.

```bash
./search/kb-search "query here"             # search
./search/kb-search --build                  # rebuild index after KB changes
./search/kb-search "query" --top 10         # more results
```

Search auto-builds the index on first query if none exists.

## Prompt Design Rules

These rules govern how `CLAUDE.md` is modified. Read before any edit.

1. **User-agnostic always.** The prompt serves every user, not one. Never reference specific conversations, specific KB content, or specific user data. Examples are allowed — and often powerful — but they must be structural (showing response *shape*) not biographical (showing one user's life). If an example could only make sense for one person, it doesn't belong unless it's clear this shows the possibility of how good it can be, and how the AI can be creative in its response.

2. **Refine before adding.** The default move is to sharpen existing language, not append new rules. More rules = more checklist behavior from the model. But if a failure reveals a genuinely new *dimension* of behavior — something no existing rule covers from any angle — it earns a new rule. The test: "Can I fix this by rewording an existing rule?" If yes, reword. If no, add.

3. **One idea per rule.** Don't bolt multiple instructions together with "but also" clauses. If a rule needs a caveat that's really a separate behavior, it's two rules. Dense multi-clause rules get partially followed — the model grabs the first idea and drops the rest.

4. **Principles over patterns.** Rules should describe the *quality* the response needs to have, not the specific *move* the model should make. "Go deep on fewer threads" is a principle. "Pick exactly 2 threads and write 3 paragraphs on each" is a pattern that will produce mechanical responses. Trust the model to execute well when it understands what good looks like.

5. **Every rule must have a failure behind it.** If you can't point to a real conversation where the absence of this rule caused a visible problem, you don't need the rule. Preemptive rules bloat the prompt with hypothetical corrections.

6. **Format shapes behavior.** Numbered rules invite compliance — the model tries to satisfy every item and produces report-like responses. Narrative descriptions invite embodiment — the model aims for a gestalt. Choose the format that produces the behavior you want. Not everything in the prompt should be a numbered list.

## Web UI Architecture (`web/`)

The web UI uses a modular architecture. Both backend and frontend are split into single-purpose files.

```
web/
  server.js              → Init + WS routing (~250 lines)
  lib/
    profiles.js          → Profile CRUD + .active-profile config
    conversations.js     → Conversation storage
    file-tree.js         → File tree + watcher + broadcast
    tool-humanize.js     → Tool name/path humanization
    claude-bridge.js     → Claude CLI spawn + stream parsing
    import-orchestrator.js → ChatGPT import pipeline
    parse-export.js      → ChatGPT export parser
    import-worker-pool.js → Parallel ingestion workers
    summarize-worker.js  → Haiku summarization
    import-prompts.js    → Prompt templates
    collection-manifest.js → Collection/batch manifest CRUD
    collection-detect.js   → File type detection + grouping
    collection-prompts.js  → Transcription, assembly, synthesis prompts
    collection-transcribe.js → Image transcription via Claude workers
    collection-audio.js    → Audio transcription via Whisper
    collection-text.js     → Text file processing
    collection-synthesis.js → Synthesis worker (KB updates from collections)
    collection-dates.js    → Date interpolation for image batches
    collection-orchestrator.js → Collection pipeline coordinator
  public/
    index.html           → Shell (loads ES modules + CSS sheets)
    app.js               → Init + event binding (~45 lines)
    js/
      state.js           → Shared state + DOM refs
      ws.js              → WebSocket connect/send
      router.js          → Message dispatch
      chat.js            → Send/stream/render messages
      conversations.js   → Conversation list UI
      explorer.js        → File tree, tabs, drag-drop
      profiles.js        → Profile dropdown
      onboarding.js      → Import wizard + triage
      collections.js     → Collection wizard (create, add batch, upload)
      collection-browser.js → Sidebar collection list + detail view
      collection-viewer.js  → Full-screen collection content reader
      utils.js           → escapeHtml, formatTime, linkify
    css/
      base.css           → Variables, reset, grid, shared markdown
      sidebar.css        → Sidebar + profile dropdown
      chat.css           → Messages, streaming, tool log, input
      explorer.css       → File tree, tabs, viewer
      onboarding.css     → Onboarding + triage + live construction
      collections.css    → Collection wizard, browser, viewer styles
```

### Server Management

```bash
web/srv start     # start server (port 3141)
web/srv stop      # kill server
web/srv restart   # stop + start
web/srv status    # check if running
```

### File Size Rule

**No source file should exceed 200 lines.** When adding functionality, create a new module. When a file approaches 200 lines, extract a concern before continuing. The `lib/` pattern (single-purpose, <200 lines each) is the standard.

## Voice Recordings

When a user drops audio files, Claude transcribes with Whisper, stores originals and transcripts in `data/voice/`, then processes content into the KB. See the Voice Recording Workflow section in `CLAUDE.md`.
