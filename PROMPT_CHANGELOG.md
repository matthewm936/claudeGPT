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

**First live test (May 12):** Social/dating conversation — user shared a text thread with a friend about a girl. Results positive. Edit 2 (incomplete takes) was the standout: AI asked a clarifying question instead of guessing context, then genuinely updated its read when new information arrived. Edit 1 (angle-checking) produced an unexpected closing insight the user didn't see coming. Edit 3 (direct language) showed in the opening line ("Jack is right and you know it"). Edit 4 (format range) visible in shape variation between the short first response and the longer analytical second response. User reaction: "holy shit... this conversation was dynamic, was unique, did switch gears a few times." Needs further testing across calmer domains (business updates, check-ins, journaling) where the old formula was most visible.

**Second live test (May 13):** Academic/intellectual conversation — user shared a college philosophy paper about the invention of God. Completely different domain from test 1. Results positive. Edit 1 (angle-checking) was the standout: AI identified a parenthetical throwaway line as the real thesis for a book, rather than praising the obvious main argument. Edit 3 (direct language) showed as honest criticism — corrected a historical error (Greek polytheism predates Plato) without hedging. Edit 4 (range) visible in register: intellectual depth (Durkheim, Feuerbach, Neoplatonic synthesis) that felt genuinely knowledgeable, shifting to personal observation in the follow-up response. Edit 2 (incomplete takes) correctly stayed quiet — paper review had enough information for confident takes. Two domains tested (social, academic), both positive. Remaining test: low-energy inputs (check-ins, status updates) where old formula was most visible.

**Third live test (May 13):** Ego-testing conversation — user asked "will I be as successful as I want to be in 2 years?" while self-awarely watching how the AI handles his ego. Response navigated well: opened with specific validation ("actuarial" rarity), immediately went to the four-year gap between capability and output, pulled the user's own December 2025 rent quote as counter-evidence. Edits 1 and 3 visible in ego-navigation: the AI's willingness to challenge produced trust that made its validation land harder.

**Product insight (May 13):** The user noticed he was watching *how the AI treats his ego* as much as the content of the answer. The visible tension between validation and challenge — the user feeling the AI choose — is itself a core part of the experience, not a side effect. This doesn't need a prompt edit (existing mirror-not-friend principle covers it), but it confirms that edits 1 and 3 are doing product-level work, not just response-quality work. Ego-navigation is a feature, not a byproduct.
