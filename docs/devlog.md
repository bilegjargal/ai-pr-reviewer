# Building AI PR Reviewer: Three Bugs and What They Taught Me

*A devlog covering the issues I hit shipping a GitHub Action that reviews PRs
with a cheap LLM and pushes a fix prompt to Slack.*

The design is simple: on every PR, a cheap model (DeepSeek/Kimi) reviews the
diff in CI, posts inline comments, and sends a copy-paste-ready fix prompt to
Slack. You paste that into Claude on your phone, it applies the fixes and
pushes. No Anthropic API cost in CI, no OAuth-in-CI.

The design was the easy part. Here are the three bugs that actually mattered.

---

## Bug 1: Slack silently posted nothing — and lied about why

**Symptom.** With `SLACK_BOT_TOKEN` and `SLACK_CHANNEL` set as repo secrets, the
action logged:

```
No Slack credentials provided; skipping Slack notification.
```

The credentials *were* provided. The message was wrong.

**Finding.** Two separate problems stacked on top of each other.

*1. The secrets weren't reaching the action.* GitHub repo secrets are not
automatically exposed to a composite action's inputs — the consumer workflow's
`with:` block has to forward each one explicitly. My example template had the
bot lines commented out:

```yaml
slack-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
# slack-bot-token: ${{ secrets.SLACK_BOT_TOKEN }}   # <- the trap
# slack-channel: ${{ secrets.SLACK_CHANNEL }}
```

Anyone who copied it added the secrets but never forwarded them.

*2. The code only used the bot for long prompts.* Even once wired, the notify
logic gated the bot path on prompt size:

```js
if (botToken && channel && prompt.length > 2800) { ...bot...; return; }
if (webhookUrl) { ...webhook...; return; }
console.warn("No Slack credentials provided; skipping...");
```

A short prompt + bot-only + no webhook fell through *all three* branches to a
warning that was simply inaccurate. The credentials existed; the code just never
used them for the common case.

**Fix.** Make the bot the primary path for any size, and fix the misleading log:

```js
if (botToken && channel) { ...bot...; return; }   // any size
if (webhookUrl) { /* warn if truncating */ ...webhook...; return; }
```

**Lesson.** When a log says "missing X," verify it actually checked for X. A
falsy-fallthrough that prints "not configured" hides "configured but unused."
The error message cost me more time than the bug.

---

## Bug 2: $2 for seven tiny PRs

**Symptom.** Testing with 5–7 PRs of small changes ran up a **$2** bill on a
model that's supposed to cost fractions of a cent per review.

**Finding.** The provider dashboard told the whole story:

| | Tokens |
|---|---|
| Input (cache miss) | 864,886 |
| Input (cache hit) | 111,104 |
| Output | 57,623 |

A **15:1 input-to-output ratio** and ~140K input tokens *per PR*. That's not a
review — that's a giant prompt producing a tiny answer. The cause: the reviewer
looped over **every file in the PR** with no filtering. In a JS project, almost
every change drags along `package-lock.json` — and a single dependency bump is
10,000+ lines. The lock file dwarfed the actual source change and got fed to the
LLM verbatim.

**Fix.** Skip machine-generated diffs before the API call, and cap per-file
patch size:

```js
const IGNORE_PATTERNS = [
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$/,
  /(^|\/)(Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/,
  /(^|\/)(dist|build|out|vendor|node_modules|\.next|coverage)\//,
  /\.(min\.js|min\.css|map|snap)$/,
];
const MAX_PATCH_CHARS = 16_000;
```

Each skip logs *why*, so the cost is visible in the Actions log instead of
hidden in a bill.

**Lesson.** "Small change" is a human judgment the machine doesn't share. When
cost scales with input tokens, audit what's actually in the prompt — the
expensive part is usually something you never looked at. A lopsided
input/output ratio is the fingerprint of "huge prompt, tiny answer."

*Still open:* the action re-reviews the whole PR on every push (`synchronize`),
not just newly-changed files. Filtering removed the dominant cost; reviewing
only changed-since-last-SHA files is the next optimization.

---

## Bug 3: the fix was correct, but nobody got it

**Symptom.** I fixed the code, committed, pushed — and consumers still ran the
broken version.

**Finding.** Distribution here is GitHub-native, and the entry points resolve
differently:

| Entry point | Resolves to | Updates when |
|---|---|---|
| `uses: ...@v1` | the **git tag** `v1` | you move the tag |
| `npx github:...` | branch **HEAD** | you push |

`package.json`'s `version` field is irrelevant — nothing is published to npm.
Consumers pin to `@v1`, which is frozen at whatever commit the tag points to. A
push to `main` doesn't move it.

**Fix.** Force-move the major tag after shipping a fix:

```
git push origin main
git tag -f v1 && git push -f origin v1
```

**Lesson.** "Did I publish?" depends entirely on your distribution model. For a
GitHub Action consumed by tag, the *tag* is the release — not the commit, not
the version string. Know which ref your users actually pin to.

---

## Takeaways

- **Distrust your own error messages.** "Not configured" often means
  "configured but unused."
- **Audit prompt inputs, not just outputs.** Token cost hides in the files you
  don't think about.
- **The release is the ref your users pin to.** For a tag-consumed Action, move
  the tag or you didn't ship.
