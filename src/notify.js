// Render a self-contained, copy-paste-ready prompt for the Claude mobile app.
export function renderFixPrompt({ owner, repo, branch, prNumber, prUrl, issues }) {
  const items = issues
    .map((c) => `- ${c.path}:${c.line} — [${c.severity}] ${c.body}`)
    .join("\n");

  return `Apply the following code review feedback to PR #${prNumber} on ${owner}/${repo} (branch: ${branch}).

For each item: make the fix, then run the test suite if one exists. When all items are addressed, commit with a clear message and push to the branch "${branch}".

PR: ${prUrl}

Feedback:
${items}`;
}

// Slack section text caps at 3000 chars. For anything sizeable we upload the
// prompt as a file snippet (no practical limit, clean copy button on mobile).
// Webhooks can't upload files, so snippet mode needs a bot token + channel.
export async function notifySlack({ webhookUrl, botToken, channel, prompt, prUrl, issueCount }) {
  const header = `🤖 *${issueCount} issue(s)* found in <${prUrl}|PR review>`;

  // Prefer a file snippet when we have a bot token and the prompt is large.
  if (botToken && channel && prompt.length > 2800) {
    const res = await fetch("https://slack.com/api/files.upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        channels: channel,
        content: prompt,
        filename: `fix-prompt-pr.txt`,
        title: `Fix prompt — ${issueCount} issue(s)`,
        initial_comment: header,
      }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`Slack upload failed: ${json.error}`);
    return;
  }

  // Otherwise post a fenced block via webhook (one-tap copy in Slack mobile).
  if (webhookUrl) {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: header } },
          { type: "section", text: { type: "mrkdwn", text: "```" + prompt.slice(0, 2800) + "```" } },
        ],
      }),
    });
    return;
  }

  console.warn("No Slack credentials provided; skipping Slack notification.");
}
