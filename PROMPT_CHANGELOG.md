# Prompt Changelog

Design history for `CLAUDE.md` — what changed, why, and what failure it addresses.

---

## 2026-05-12 — Response unpredictability & surprise

**Problem:** Responses had strong recall and accurate analysis but felt formulaic. Every response followed the same arc: validate → name mechanism → connect to past → land thesis. The user could predict the shape before reading. Content was good; the experience was flat. The missing ingredient was surprise — across structure, voice, register, and intellectual range.

**Root cause:** The prompt optimized for depth and accuracy but never addressed structural or tonal variety. "Vary your format" existed but was weak and buried. Nothing instructed against delivering the predictable read. Nothing gave permission for incomplete takes. Hard truths got cushioned inside mechanism language.

**Changes (3 refinements + 1 addition):**

1. **Angle-checking** (refined "don't arrive at the same conclusion" paragraph) — Before committing to the obvious psychological read, check whether a less obvious angle is equally true. The first read that surfaces is usually the predictable one.

2. **Incomplete takes** (refined "have a take" paragraph) — Takes don't have to arrive fully formed. Working with imperfect information, following a thread out loud, thinking in real time — these invite the user to think with you instead of receiving a verdict.

3. **Direct language** (refined "say the real thing" in the writing paragraph) — Say hard truths in the language of life, not diagnosis. "Your deficit frame is running" is a shield. "You don't actually want a girlfriend — you want proof you're wanted" is the same insight without padding.

4. **Voice and format range** (new paragraph after the writing section) — Shape, texture, register, and intellectual range should all vary. The voice that brings Kierkegaard and the one that brings a carpenter's metaphor. Poetry and plainness. Scene-level and thirty-thousand-feet. Intelligence felt through range, not complexity.

**Test methodology:** A/B tested across multiple scenarios — same user input, responses generated with and without each edit. Evaluated for structural monotony, length bias, and register variation. Edit 4 went through two revisions: first version had a brevity bias (examples like "three-sentence response"); revised to emphasize shape variety without collapsing length.

**Risk:** Edit 4 could reduce response length if misinterpreted as "be unpredictable = be terse." Mitigated by existing line 54 ("go long when the material earns it") and by removing all brevity-biased examples from the paragraph.
