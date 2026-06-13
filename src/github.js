import { Octokit } from "@octokit/rest";

export function makeGitHub({ token, owner, repo }) {
  const octokit = new Octokit({ auth: token });

  return {
    // Per-file patches (used to feed the model) + the raw unified diff
    // (used to validate comment line positions).
    async getPR(pull_number) {
      const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number });

      const files = await octokit.paginate(octokit.pulls.listFiles, {
        owner,
        repo,
        pull_number,
        per_page: 100,
      });

      // Raw unified diff via the diff media type.
      const { data: rawDiff } = await octokit.pulls.get({
        owner,
        repo,
        pull_number,
        mediaType: { format: "diff" },
      });

      return {
        headSha: pr.head.sha,
        branch: pr.head.ref,
        title: pr.title,
        url: pr.html_url,
        files: files.map((f) => ({ path: f.filename, patch: f.patch })),
        rawDiff: String(rawDiff),
      };
    },

    async postReview({ pull_number, commit_id, inline, orphan }) {
      if (inline.length === 0 && orphan.length === 0) {
        await octokit.pulls.createReview({
          owner, repo, pull_number, commit_id,
          event: "COMMENT",
          body: "🤖 AI review: no issues found.",
        });
        return;
      }

      const orphanBody = orphan.length
        ? "\n\n**Additional notes (couldn't attach to a line):**\n" +
          orphan.map((c) => `- \`${c.path}:${c.line}\` — **${c.severity}**: ${c.body}`).join("\n")
        : "";

      await octokit.pulls.createReview({
        owner, repo, pull_number, commit_id,
        event: "COMMENT",
        body: `🤖 AI review complete.${orphanBody}`,
        comments: inline.map((c) => ({
          path: c.path,
          line: c.line,
          side: "RIGHT",
          body: `**${c.severity}**: ${c.body}`,
        })),
      });
    },
  };
}
