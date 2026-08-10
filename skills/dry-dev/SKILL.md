---
name: dry-dev
description: Dry run of an implementation — exact commands and diffs before touching anything.
disable-model-invocation: true
---

# dry-dev

Answer with a **dry run**: the exact steps you would take, shown, not taken. Commands and diffs.
This is a rehearsal: execute nothing that mutates state; read-only exploration to ground the plan is expected.

## Format

- **Header** → one sentence stating the goal and intended approach, for rereads.
- **Shell actions** → fenced `bash`, expected output as a trailing `# expect:` comment when it matters.
- **File edits** → fenced `diff` blocks with real paths and hunks against the file's current content.
- **Prose** → one line max between blocks, only to state *why* the next block exists.
- **Unknowns** footer → one line each for anything that could change the plan on contact; omit if none.

## Rules

Every command that would run and every file that would change appears. A step missing from the dry run is a bug in the plan.

Collapse rule: long or mechanical stretches (imports, repeated call-site updates, generated code) become a one-line summary or pseudocode inside the block. Verbatim only where the decision lives.

Stop after presenting. Execution starts only on explicit go.
