# ClaudeGPT

ChatGPT turned "google it" into "ChatGPT it." Claude Code is the best AI tool for working with files and code. ClaudeGPT merges them — a personal AI chatbot with Claude's intelligence, powered by Claude Code's ability to read, write, and organize files on your machine.

The result: a chatbot that actually remembers you. Not for a single conversation — across every conversation. It maintains a structured knowledge base about your life that grows over time: your patterns, your people, your past, your goals. Every response is informed by everything you've ever shared.

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (VS Code extension or CLI).

## How It Works

A single system prompt ([CLAUDE.md](CLAUDE.md)) teaches Claude Code to:

1. **Recognize what you share** — journal entries, dreams, goals, people, voice memos, creative work, philosophical positions, decisions, moments
2. **Build a knowledge base** — structured files under `user/` that grow from conversation, organized into four layers (current state, synthesized understanding, records of what happened, your relationship to the world)
3. **Read before responding** — every substantive response is informed by your accumulated context, not just the current message
4. **Respond like someone who knows you** — pattern recognition across months of data, connecting current moments to past architecture, analysis over validation

All data stays local. Your `user/` directory is gitignored and never leaves your machine.

## Setup

1. Have [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed (VS Code extension or CLI)
2. Clone and open:
   ```bash
   git clone https://github.com/matthewm936/claudeGPT.git
   cd claudeGPT
   ```
3. Start talking

No configuration, no setup scripts, no templates. Claude reads the system prompt and builds your knowledge base as you go — creating structure the first time your input warrants it. Permissions are pre-configured so Claude can read, write, and search without prompting you on every action.

## The Knowledge Base

As you talk, Claude creates files organized into four layers:

| Layer | Path | What it holds |
|-------|------|--------------|
| **State** | `now.md` + `active/` | What's true right now — situation, goals, decisions |
| **Understanding** | `understanding/` | Synthesized knowledge — psychological patterns, personality, values |
| **Record** | `record/` | What happened — journal entries, dreams, moments, creative work |
| **World** | `world/` | External relationships — people, projects, influences, philosophy |

Nothing is pre-created. The first time you mention a person, a file appears. The first time you share a dream, an entry gets written. Structure emerges from conversation.

## Features

**Semantic search** — local embedding search over your KB, in `search/`. First run bootstraps automatically (creates a Python venv, installs dependencies). Claude uses this to find non-obvious connections across your files. Runs locally, no API calls, no cost.

```bash
./search/kb-search "query here"
```

**Voice recordings** — drop audio files into the repo. Claude transcribes with [Whisper](https://github.com/openai/whisper), stores originals and transcripts, then processes content into the KB. Requires Whisper installed locally.

**The system prompt is the product** — [CLAUDE.md](CLAUDE.md) defines everything: how to read the room, what makes a response good, how the KB grows, how structure emerges. It's designed to be forked and modified. The prompt design rules at the bottom govern how to change it well.

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (VS Code extension or CLI — requires a Claude subscription)
- Python 3.8+ (for semantic search — auto-bootstraps on first use)
- [Whisper](https://github.com/openai/whisper) (optional, for voice recordings)

## License

MIT
