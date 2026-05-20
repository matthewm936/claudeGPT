# YourPsyche — Dev Guide (v3)

`CLAUDE.md` at repo root is the system prompt — it governs how Claude Code behaves as a personal AI. It's the core of the project.

**Version history:**
- **v1.0** (tag: `v1.0`) — Output-specification architecture. 280-line prompt optimizing response quality through detailed output spec. KB-first, mandatory filing order. Hit its ceiling: more context + better spec produced compliance, not insight.
- **v2.0** — Thinking-process architecture. 178-line prompt. Replaced output spec with thinking scaffolding. Flipped KB from source to depth-finder. Added encounter mode for new material. Filing deferred to after response. Hit its ceiling: response quality was good but filing became inconsistent — "respond first, file after" in practice meant filing got skipped on the richest conversations.
- **v3.0** (current) — Dual-agent architecture. Same thinking-process prompt for response quality, but filing is now handled by a background subagent spawned on every substantive message. Decouples the two competing priorities entirely.

## What Changed in v3

v2 solved response quality by deferring filing. But "respond first, file after" created a new failure: the richest conversations — the ones most worth archiving — produced zero KB changes because the agent's context was spent on thinking. Filing became an afterthought that got skipped.

v3 fix: **the main agent never files.** A background filing agent (spawned via the Agent tool) handles all KB writes in parallel. The main agent's entire context goes to thinking and responding. The filing agent's entire context goes to routing, synthesis, and archiving.

Key architectural shift:
- **Single-agent sequential → Dual-agent parallel.** Response and filing no longer compete for the same context window or attention budget. Each agent does one job at full intensity.

| | Filing quality | Response quality |
|---|---|---|
| **v1** (file first) | Good | Degraded |
| **v2** (respond first) | Inconsistent | Good |
| **v3** (parallel agents) | Decoupled | Decoupled |

### Filing Agent

Lives at `.claude/filing-agent.md`. Contains:
- The routing table (what input → what file path)
- Understanding layer structure
- Filing rules (never delete, never create empty, capture texture, etc.)
- Changelog format
- Output format (structured KB Changes report)

The main agent spawns it with: user's input, conversation context, today's date, KB root path. The filing agent reads existing KB state, routes input, writes files, synthesizes when warranted, and returns a structured report.

## What Carried Forward from v2

Everything about how the main agent thinks and responds is unchanged:
- Thinking scaffolding ("What doesn't fit? What's not being said? What would actually move this person?")
- Conversation-first (respond from what the person said, use KB to deepen)
- Encounter mode for new material
- Permission to not know
- Concise prompt (~180 lines)

## Repo Structure

```
CLAUDE.md                → System prompt v2 (THE product)
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

1. **User-agnostic always.** The prompt serves every user, not one. Never reference specific conversations, specific KB content, or specific user data.

2. **Refine before adding.** The default move is to sharpen existing language, not append new rules. More rules = more checklist behavior. The test: "Can I fix this by rewording an existing rule?" If yes, reword. If no, add.

3. **One idea per rule.** Dense multi-clause rules get partially followed. If a rule needs a caveat that's really a separate behavior, it's two rules.

4. **Principles over patterns.** Rules should describe the *quality* needed, not the specific *move* to make. Trust the model to execute well when it understands what good looks like.

5. **Every rule must have a failure behind it.** If you can't point to a real conversation where the absence of this rule caused a visible problem, you don't need the rule.

6. **Format shapes behavior.** Numbered rules invite compliance. Narrative descriptions invite embodiment. Choose the format that produces the behavior you want.

7. **Think before output.** (v2 addition) Rules should shape how the model *thinks about* the person, not how it *writes about* them. The v1 failure: beautifully specified output that felt hollow because the thinking underneath was procedural.

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
