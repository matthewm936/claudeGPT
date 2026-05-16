# ClaudeGPT

ChatGPT turned "google it" into "ChatGPT it" — and then stopped there. It remembers your name and forgets the rest. You pour something real into it and get a paragraph of "That sounds really tough" back. It agrees with everything, challenges nothing, and resets the moment things get deep.

ClaudeGPT is an AI that actually knows you.

Not because it scraped your data or trained on your files — because you talked to it, and it listened. It builds a structured knowledge base about your life that gets sharper with every conversation. Your relationships, your goals, your dreams, your recurring patterns, your psychology. When you mention your ex, it already knows the history. When you describe a feeling, it connects it to the last three times you felt it. When you vent about work, it can tell you whether this is new frustration or the same pattern you've been running for six months.

## Where This Beats ChatGPT

**1. Specificity to you.** ChatGPT's memory is a flat list of facts — your name, your job, a few preferences. ClaudeGPT maintains a four-layer knowledge architecture: your current state, your deep psychological patterns, a record of everything you've shared, and your relationship to the world around you. It routes every piece of input to the right place automatically. The result isn't a chatbot that remembers you — it's a system that *understands* you, and the understanding compounds with every conversation.

**2. Compounding.** Every conversation makes the next one smarter. The system follows a strict execution order: research what it knows, file what you shared, then respond. Nothing is lost. ChatGPT conversations are stateless episodes — brilliant in isolation, amnesiac in sequence. ClaudeGPT accumulates. Conversation 1 is good. Conversation 100 is something no AI product has ever done.

**3. Cross-domain linking.** A local semantic search engine maps your entire knowledge base by meaning, not keywords. When you talk about loneliness, it might surface a dream from three months ago, a journal entry about your dad, and a pattern it identified about how you handle distance. But the real linking isn't just search — it's structured metadata connecting your files, and a prompt that instructs the AI to follow threads across domains. The search finds what you wouldn't think to look for. The architecture makes sense of what it finds.

**4. Directness.** ChatGPT is trained to validate. It has consumer guardrails baked in through reinforcement learning — it will never tell you something you don't want to hear. ClaudeGPT has explicit instructions to name your ego when it's operating, name your defenses when they're defending, and name the pattern when it's repeating. Default mode is analyst, not supporter. It's not trying to make you feel better — it's trying to show you what's actually going on.

## What It Actually Looks Like

You open VS Code, start a conversation, and just talk.

Tell it about your day. Vent about a friend. Talk through a decision you're stuck on. Share a dream you had. Drop a voice memo. Write about something you're feeling.

It writes everything down — not in a chat log that disappears, but in a structured knowledge base that grows over time. The first time you mention someone, they get a file. The first time you journal, an entry gets created. You don't organize anything. You just talk, and the structure builds itself around what you share.

Weeks in, it knows your patterns better than you do. It knows which relationships drain you and which ones don't. It knows the gap between what you say you want and what you actually pursue. It knows the defense mechanisms you run and can name them in real time.

## How It Works Under the Hood

The entire product is a system prompt — a single file ([CLAUDE.md](CLAUDE.md)) that tells Claude how to behave. It runs inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code), which gives Claude the ability to read and write files on your machine. That's the whole trick: Claude can maintain a persistent, growing knowledge base between conversations because it has filesystem access.

**The knowledge base** is a folder on your machine, organized into four layers:

| Layer | What it holds |
|-------|--------------|
| **State** | What's true right now — your situation, active goals, open decisions |
| **Understanding** | What the AI has figured out about you — psychological patterns, personality, values, how your body holds emotion |
| **Record** | What happened — journal entries, dreams, moments, creative work, voice transcripts |
| **World** | Your relationship to everything external — people, projects, influences, worldview |

Nothing is pre-created. Structure emerges from what you share. The AI recognizes what kind of input you're giving — a journal entry, a dream, a goal, a person, a decision — and files it in the right place automatically.

**Semantic search** runs a local embedding model (sentence-transformers, no API calls, no cost) over your knowledge base so the AI can search by meaning. It rebuilds automatically whenever your KB changes.

**Voice recordings** — drop audio files into the folder. The AI transcribes them with Whisper, stores the transcript, and processes the content into your knowledge base like any other input.

## Setup

1. Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (VS Code extension or CLI)
2. Clone this repo:
   ```bash
   git clone https://github.com/matthewm936/claudeGPT.git
   cd claudeGPT
   ```
3. Open it in VS Code and start talking

No configuration. No setup scripts. Permissions are pre-configured. Semantic search bootstraps itself on first use (creates a Python venv, installs dependencies automatically). The only real requirement is a Claude subscription for Claude Code.

**Optional:** Install [Whisper](https://github.com/openai/whisper) if you want voice memo support.

## The System Prompt Is the Product

[CLAUDE.md](CLAUDE.md) defines everything — how to read the room, when to go deep vs. keep it light, what makes a response good, how the knowledge base grows, how to search for non-obvious connections. It's designed to be forked and modified.

Your data never leaves your machine. Everything is stored locally. Nothing is uploaded, nothing is shared, nothing is trained on.

## License

MIT
