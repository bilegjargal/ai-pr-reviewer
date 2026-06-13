#!/usr/bin/env node
// Interactive installer for the AI PR Reviewer action.
//
//   npx github:bilegjargal/ai-pr-reviewer
//
// Run it inside the repo you want reviewed. It scaffolds the workflow file and
// sets the required secrets via the `gh` CLI. Zero runtime dependencies — only
// Node built-ins and the `gh` / `git` binaries.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import readline from "node:readline";

const ACTION_REF = "bilegjargal/ai-pr-reviewer@v1";
const WORKFLOW_PATH = ".github/workflows/ai-review.yml";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m",
};
const ok = (m) => console.log(`${C.green}✓${C.reset} ${m}`);
const info = (m) => console.log(`${C.cyan}→${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}!${C.reset} ${m}`);
const die = (m) => { console.error(`${C.red}✗ ${m}${C.reset}`); process.exit(1); };

const args = new Set(process.argv.slice(2));
if (args.has("-h") || args.has("--help")) {
  console.log(`AI PR Reviewer — setup

Usage: npx github:bilegjargal/ai-pr-reviewer [--yes]

Run inside the git repo you want reviewed. Scaffolds ${WORKFLOW_PATH}
and sets the LLM/Slack secrets via the gh CLI.

  --yes   overwrite an existing workflow file without asking
  -h      show this help`);
  process.exit(0);
}
const assumeYes = args.has("--yes") || args.has("-y");

// ---- Preflight: git repo, GitHub remote, gh installed + authed ----------
function sh(cmd, argv) {
  return execFileSync(cmd, argv, { encoding: "utf8" }).trim();
}
function has(cmd) {
  return spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
}

let remoteUrl;
try {
  remoteUrl = sh("git", ["remote", "get-url", "origin"]);
} catch {
  die("No git repository with an 'origin' remote here. Run this inside the repo you want reviewed.");
}

// Parse owner/repo from either SSH or HTTPS GitHub remotes.
const m = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
if (!m) die(`Couldn't parse a GitHub repo from origin: ${remoteUrl}`);
const [, owner, repo] = m;
const repoSlug = `${owner}/${repo}`;

if (!has("gh")) {
  die("The GitHub CLI ('gh') is required to set secrets. Install it: https://cli.github.com");
}
if (spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status !== 0) {
  die("gh is not authenticated. Run: gh auth login");
}

console.log(`\n${C.bold}AI PR Reviewer setup${C.reset} ${C.dim}→ ${repoSlug}${C.reset}\n`);

// ---- Prompts -------------------------------------------------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(query, def) {
  const suffix = def ? ` ${C.dim}(${def})${C.reset}` : "";
  return new Promise((res) =>
    rl.question(`${query}${suffix}: `, (a) => res(a.trim() || def || "")),
  );
}
// Read a value without echoing keystrokes (for API keys / tokens).
function askSecret(query) {
  return new Promise((resolve) => {
    let muted = false;
    rl._writeToOutput = (str) => {
      if (!muted || str.includes("\n")) rl.output.write(str);
    };
    rl.question(`${query}: `, (value) => {
      rl._writeToOutput = (s) => rl.output.write(s);
      rl.output.write("\n");
      resolve(value.trim());
    });
    muted = true;
  });
}
async function pick(query, choices, def) {
  const a = (await ask(`${query} ${C.dim}[${choices.join("/")}]${C.reset}`, def)).toLowerCase();
  return choices.includes(a) ? a : def;
}

const provider = await pick("Provider", ["deepseek", "kimi"], "deepseek");
const fixSeverity = await pick("Collect into fix prompt at/above severity", ["nit", "warning", "issue"], "issue");
const notify = await pick("Notify via", ["slack", "pr", "both"], "both");

const llmKey = await askSecret(`${provider} API key ${C.dim}(LLM_API_KEY, required)${C.reset}`);
if (!llmKey) die("LLM_API_KEY is required.");

// Slack is only relevant if we're notifying there.
let webhook = "", botToken = "", channel = "";
if (notify === "slack" || notify === "both") {
  webhook = await ask(`Slack webhook URL ${C.dim}(optional, blank to skip)${C.reset}`, "");
  botToken = await askSecret("Slack bot token (optional, enables file snippets for long prompts)");
  if (botToken) channel = await ask("Slack channel ID (required with bot token)", "");
}

rl.close();

// ---- Build the workflow file --------------------------------------------
const slackLines = [];
if (webhook) slackLines.push("          slack-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}");
if (botToken) {
  slackLines.push("          slack-bot-token: ${{ secrets.SLACK_BOT_TOKEN }}");
  slackLines.push("          slack-channel: ${{ secrets.SLACK_CHANNEL }}");
}
const slackBlock = slackLines.length
  ? "\n" + slackLines.join("\n")
  : "\n          # No Slack secrets configured — add slack-webhook-url to enable.";

const workflow = `# Generated by: npx github:${ACTION_REF.split("@")[0]}
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: AI PR Reviewer
        uses: ${ACTION_REF}
        with:
          provider: ${provider}
          fix-severity: ${fixSeverity}
          notify: ${notify}
          llm-api-key: \${{ secrets.LLM_API_KEY }}
          github-token: \${{ secrets.GITHUB_TOKEN }}${slackBlock}
`;

// ---- Confirm, then write + set secrets ----------------------------------
const secrets = [["LLM_API_KEY", llmKey]];
if (webhook) secrets.push(["SLACK_WEBHOOK_URL", webhook]);
if (botToken) secrets.push(["SLACK_BOT_TOKEN", botToken]);
if (channel) secrets.push(["SLACK_CHANNEL", channel]);

console.log(`\n${C.bold}Plan${C.reset}`);
console.log(`  write   ${WORKFLOW_PATH}  ${C.dim}(provider=${provider}, notify=${notify})${C.reset}`);
console.log(`  set     ${secrets.map(([k]) => k).join(", ")}  ${C.dim}on ${repoSlug}${C.reset}\n`);

if (existsSync(WORKFLOW_PATH) && !assumeYes) {
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((res) =>
    rl2.question(`${C.yellow}${WORKFLOW_PATH} exists. Overwrite? [y/N]${C.reset} `, res),
  );
  rl2.close();
  if (!/^y(es)?$/i.test(a.trim())) die("Aborted; nothing changed.");
}

mkdirSync(dirname(WORKFLOW_PATH), { recursive: true });
writeFileSync(WORKFLOW_PATH, workflow);
ok(`wrote ${WORKFLOW_PATH}`);

for (const [name, value] of secrets) {
  // Pipe the value through stdin so it never lands in argv (visible via `ps`).
  const r = spawnSync("gh", ["secret", "set", name, "--repo", repoSlug], {
    input: value,
    stdio: ["pipe", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (r.status === 0) ok(`set secret ${name}`);
  else { warn(`failed to set ${name}: ${(r.stderr || "").trim()}`); }
}

console.log(`\n${C.green}${C.bold}Done.${C.reset}`);
info(`Commit & push the workflow:`);
console.log(`    git add ${WORKFLOW_PATH} && git commit -m "Add AI PR review" && git push`);
info(`Then open a PR — the reviewer runs automatically.`);
