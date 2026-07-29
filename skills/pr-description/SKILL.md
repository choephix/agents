---
name: pr-description
description: Use when writing or revising a pull request description.
---

A write-up about a change is judged from the reader's seat: what the reader most needs decides what appears and in what order.
The shape this produces is an inverted pyramid — importance strictly decreasing, so the reader can stop after any paragraph and still hold a correct, usefully prioritized picture.

**Headline**
The first line alone is enough to understand what was changed and why the PR matters — a teammate reading nothing else can tell whether it concerns them. 
The title obeys the same rule compressed: name the behavior, not the code touched.

**Story**
Next is a very concise account of what someone can actually do in the app that would have gone differently before. App-level words only — no class names, no subsystem jargon. 

**Mechanism**
Here progressive disclosure begins: exactly what was wrong or missing, then exactly how it was answered — a causal chain in firing order, including what it trades away.
Telegraphic: fragments over sentences. Sacrifice grammar for clarity and concision.

**Evidence**
What ran and what it showed: before/after observations, guards added, caveats stated plainly. Numbers over adjectives.

The whole thing is freeform prose. Markdown appears only where it genuinely helps parsing, never as decoration.

Headline register, by example:
- Weak: "Refactor pointer-lock handling in ContextInputHardwareSource."
- Strong: "Character controls work again — since #10618 they self-destructed within a frame
of attaching, for every desktop user."
