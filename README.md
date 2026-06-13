# AI PR Reviewer

A reusable GitHub Action that reviews pull requests with a cheap LLM
(DeepSeek or Kimi), posts inline line comments, and sends a **copy-paste-ready
fix prompt** to Slack. You paste that prompt into the Claude mobile app, which
applies the fixes and pushes — no Anthropic API cost, no OAuth-in-CI.

```
PR opened/updated
  → cheap model reviews the diff
    → inline comments posted on the PR
      → 'issue'-severity items collected into one prompt
        → prompt sent to Slack (notification + one-tap copy)
          → you paste it into Claude mobile → it fixes + pushes
```

## Why this design

- **Reviewer runs in CI** (free on Actions, cheap LLM). Runs on every PR.
- **Claude runs on your phone**, interactively — which is what a Max/Pro plan
  is for. Using subscription OAuth tokens inside GitHub Actions is against
  Anthropic's policy, so we deliberately keep the fix step manual + interactive.

## Setup (publish once)

1. Push this repo to GitHub, e.g. `bilegjargal/ai-pr-reviewer`.
2. Tag a release: `git tag v1 && git push --tags`.

## Integrate into any repo

### Quick install (recommended)

From inside the repo you want reviewed:

```
npx github:bilegjargal/ai-pr-reviewer
```

It interactively scaffolds `.github/workflows/ai-review.yml` and sets the
required secrets via the [`gh` CLI](https://cli.github.com) (you must be
`gh auth login`'d). Then commit the workflow, push, and open a PR.

### Manual install

1. Copy `.github/workflows/example-consumer.yml` into the target repo as
   `.github/workflows/ai-review.yml` and update the `uses:` line.
2. Add these secrets to that repo (Settings → Secrets and variables → Actions):

   | Secret | Required | Purpose |
   |---|---|---|
   | `LLM_API_KEY` | yes | DeepSeek or Kimi API key |
   | `SLACK_WEBHOOK_URL` | for Slack | Incoming webhook for fenced-block posts |
   | `SLACK_BOT_TOKEN` | optional | Enables file-snippet posts for long prompts |
   | `SLACK_CHANNEL` | with bot token | Channel ID to post to |

   `GITHUB_TOKEN` is provided automatically by Actions.

## Inputs

| Input | Default | Options |
|---|---|---|
| `provider` | `deepseek` | `deepseek`, `kimi` |
| `model` | provider default | any model string |
| `fix-severity` | `issue` | `nit`, `warning`, `issue` |
| `notify` | `both` | `slack`, `pr`, `both` |

## Switching models

Set `provider: kimi` (or `deepseek`) in the consumer workflow. To pin a model,
set `model:`. Add new providers in `src/reviewer.js` — any OpenAI-compatible
endpoint works.

## Outputs

`has-issues`, `issue-count`, `fix-prompt` — usable by downstream steps if you
later want to automate further.
