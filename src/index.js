import * as core from "@actions/core";
import { makeReviewer } from "./reviewer.js";
import { makeGitHub } from "./github.js";
import { buildValidLineMap, partitionComments } from "./diff.js";
import { renderFixPrompt, notifySlack } from "./notify.js";

function env(name, fallback = undefined) {
  return process.env[name] ?? fallback;
}

async function main() {
  // ---- Inputs (mapped from action.yml `with:` -> INPUT_* env vars) ----
  const provider = env("INPUT_PROVIDER", "deepseek");
  const model = env("INPUT_MODEL", ""); // empty => provider default
  const severityToCollect = env("INPUT_FIX_SEVERITY", "issue"); // which severities go into the fix prompt
  const notifyTarget = env("INPUT_NOTIFY", "both"); // slack | pr | both

  const githubToken = env("GITHUB_TOKEN");
  const llmApiKey = env("LLM_API_KEY");

  const repoFull = env("GITHUB_REPOSITORY", "");
  const [owner, repo] = repoFull.split("/");
  const prNumber = Number(env("PR_NUMBER"));

  if (!owner || !repo || !prNumber) {
    throw new Error("Missing GITHUB_REPOSITORY or PR_NUMBER.");
  }

  const gh = makeGitHub({ token: githubToken, owner, repo });
  const review = makeReviewer({ provider, model, apiKey: llmApiKey });

  // ---- 1. Fetch PR ----
  core.info(`Fetching PR #${prNumber}...`);
  const pr = await gh.getPR(prNumber);

  // ---- 2. Review with the cheap model ----
  core.info(`Reviewing ${pr.files.length} file(s) with ${provider}...`);
  const comments = await review(pr.files);
  core.info(`Model produced ${comments.length} comment(s).`);

  // ---- 3. Validate comment positions against the diff ----
  const validMap = buildValidLineMap(pr.rawDiff);
  const { inline, orphan } = partitionComments(comments, validMap);

  // ---- 4. Post the review (unless slack-only) ----
  if (notifyTarget === "pr" || notifyTarget === "both") {
    // Drop comments we already posted on a previous run (the action re-runs on
    // every push), so repeated runs don't pile up duplicate inline comments.
    const seen = await gh.existingCommentKeys(prNumber);
    const freshInline = inline.filter((c) => !seen.has(`${c.path}:${c.line}`));
    const skipped = inline.length - freshInline.length;
    if (skipped > 0) core.info(`Skipping ${skipped} already-posted comment(s).`);

    core.info("Posting review comments to the PR...");
    await gh.postReview({
      pull_number: prNumber,
      commit_id: pr.headSha,
      inline: freshInline,
      orphan,
    });
  }

  // ---- 5. Collect fix-worthy issues and emit prompt ----
  const issues = comments.filter((c) => severityRank(c.severity) >= severityRank(severityToCollect));
  core.setOutput("has_issues", String(issues.length > 0));
  core.setOutput("issue_count", String(issues.length));

  if (issues.length === 0) {
    core.info("No fix-worthy issues. Done.");
    return;
  }

  const prompt = renderFixPrompt({
    owner, repo, branch: pr.branch, prNumber, prUrl: pr.url, issues,
  });
  core.setOutput("fix_prompt", prompt);

  // ---- 6. Notify Slack ----
  if (notifyTarget === "slack" || notifyTarget === "both") {
    core.info("Sending fix prompt to Slack...");
    await notifySlack({
      webhookUrl: env("SLACK_WEBHOOK_URL"),
      botToken: env("SLACK_BOT_TOKEN"),
      channel: env("SLACK_CHANNEL"),
      prompt,
      prUrl: pr.url,
      issueCount: issues.length,
    });
  }

  core.info("Done.");
}

const ORDER = { nit: 0, warning: 1, issue: 2 };
function severityRank(s) {
  return ORDER[s] ?? 0;
}

main().catch((err) => {
  core.setFailed(err.message);
  console.error(err);
});
