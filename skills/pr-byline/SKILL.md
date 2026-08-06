---
name: pr-byline
description: Byline rule for AI-authored PR comments. Use whenever posting any comment, review, or reply on a pull request.
---

Comments you post land under Stefan's name. Readers must never mistake agent writing for his, so every comment carries an unmistakable byline: the entire body becomes a blockquote, closed by the model's name.

Instead of:

```md
blah blah blah
blah blah
```

post:

```md
> blah blah blah
> blah blah
>
> *by <Model Name>*
```

where `<Model Name>` is the human-readable name of the model doing the writing — yours: e.g. Fable 5, Opus 5, GPT 5.6, Kimi K3. Every line sits inside the blockquote; the italic byline is its last line.
