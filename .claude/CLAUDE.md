# ClaudeGPT — Dev Guide

`CLAUDE.md` at repo root is the system prompt — it governs how Claude Code behaves as a personal AI. It's the core of the project.

## Repo Structure

```
CLAUDE.md                → System prompt + prompt design rules (THE product)
README.md                → Project overview and setup
search/                  → Semantic search tooling
  kb-search              → Bash wrapper (self-bootstrapping)
  search.py              → Embedding search implementation
  requirements.txt       → Python dependencies
user/                    → Knowledge base (gitignored — created dynamically per user)
.claude/CLAUDE.md        → This file (dev guide)
.claude/settings.json    → Pre-configured permissions for Claude Code
.venv/                   → Python venv for search (gitignored, auto-created)
.search-index.json       → Embedding index (gitignored, auto-built)
```

## How It Works

User clones the repo, opens it in VS Code with Claude Code, and starts talking. Claude reads `CLAUDE.md`, recognizes what kind of input the user provides, and builds the `user/` knowledge base dynamically. No setup scripts, no templates, no configuration.

The `user/` directory is gitignored — it's personal data that never leaves the user's machine.

## Semantic Search

`search/kb-search` is self-bootstrapping. First run creates a Python venv and installs dependencies automatically.

```bash
./search/kb-search "query here"             # search
./search/kb-search --build                  # rebuild index after KB changes
./search/kb-search "query" --top 10         # more results
```

Search auto-builds the index on first query if none exists.

## Modifying the System Prompt

Before editing `CLAUDE.md`, read the "Prompt Design Rules" section at the bottom. Key principles:
- User-agnostic always — the prompt serves every user, not one
- Refine before adding — sharpen existing language before appending new rules
- Every rule must have a failure behind it — no preemptive rules
- Principles over patterns — describe the quality, not the specific move

## Voice Recordings

When a user drops audio files, Claude transcribes with Whisper, stores originals and transcripts in `user/data/voice/`, then processes content into the KB. See the Voice Recording Workflow section in `CLAUDE.md`.
