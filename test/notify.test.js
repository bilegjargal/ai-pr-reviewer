import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFixPrompt } from "../src/notify.js";

const ISSUES = [
  { path: "a.js", line: 5, severity: "issue", body: "null deref" },
  { path: "b.js", line: 12, severity: "warning", body: "missing await" },
];

test("renderFixPrompt includes repo, PR number, and branch", () => {
  const out = renderFixPrompt({
    owner: "bilegjargal",
    repo: "ai-pr-reviewer",
    branch: "feature",
    prNumber: 42,
    prUrl: "https://github.com/bilegjargal/ai-pr-reviewer/pull/42",
    issues: ISSUES,
  });
  assert.match(out, /PR #42 on bilegjargal\/ai-pr-reviewer/);
  assert.match(out, /branch: feature/);
  assert.match(out, /push to the branch "feature"/);
});

test("renderFixPrompt lists each issue with path, line, and severity", () => {
  const out = renderFixPrompt({
    owner: "o",
    repo: "r",
    branch: "b",
    prNumber: 1,
    prUrl: "http://x",
    issues: ISSUES,
  });
  assert.match(out, /- a\.js:5 — \[issue\] null deref/);
  assert.match(out, /- b\.js:12 — \[warning\] missing await/);
});

test("renderFixPrompt includes the PR url", () => {
  const out = renderFixPrompt({
    owner: "o",
    repo: "r",
    branch: "b",
    prNumber: 1,
    prUrl: "http://example/pr/1",
    issues: ISSUES,
  });
  assert.match(out, /PR: http:\/\/example\/pr\/1/);
});
