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

  // Bot-first: a file snippet carries the full prompt at any size with a clean
  // mobile copy button. Use it whenever a bot token + channel are configured.
  if (botToken && channel) {
    await uploadSnippet({ botToken, channel, prompt, issueCount, header });
    return;
  }

  // Fallback: post a fenced block via webhook (one-tap copy in Slack mobile).
  // Slack section text caps at ~3000 chars, so oversized prompts get truncated.
  if (webhookUrl) {
    if (prompt.length > 2800) {
      console.warn(
        `Prompt is ${prompt.length} chars; webhook truncates to 2800. ` +
          "Configure SLACK_BOT_TOKEN + SLACK_CHANNEL to post the full prompt.",
      );
    }
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

// Upload the prompt as a file via Slack's external-upload flow. The legacy
// files.upload endpoint was retired in 2025, so this is the three-step dance:
// 1) reserve an upload URL, 2) PUT the bytes there, 3) finalize + share to the
// channel with an initial comment.
async function uploadSnippet({ botToken, channel, prompt, issueCount, header }) {
  const filename = "fix-prompt-pr.txt";
  const bytes = Buffer.byteLength(prompt, "utf8");

  // 1) Reserve an upload URL.
  const getUrl = await slackGet(
    "https://slack.com/api/files.getUploadURLExternal",
    botToken,
    { filename, length: String(bytes) },
  );
  const { upload_url, file_id } = getUrl;

  // 2) PUT the raw content to the returned URL.
  const put = await fetch(upload_url, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: prompt,
  });
  if (!put.ok) throw new Error(`Slack upload PUT failed: ${put.status} ${put.statusText}`);

  // 3) Finalize and share into the channel with the header as the comment.
  await slackPostJson(
    "https://slack.com/api/files.completeUploadExternal",
    botToken,
    {
      files: [{ id: file_id, title: `Fix prompt — ${issueCount} issue(s)` }],
      channel_id: channel,
      initial_comment: header,
    },
  );
}

// POST form-encoded to a Slack Web API method and assert ok.
async function slackGet(url, botToken, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack ${url} failed: ${json.error}`);
  return json;
}

// POST JSON to a Slack Web API method and assert ok.
async function slackPostJson(url, botToken, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack ${url} failed: ${json.error}`);
  return json;
}
