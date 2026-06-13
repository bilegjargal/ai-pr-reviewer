import OpenAI from "openai";

// Registry of supported cheap providers. All expose OpenAI-compatible APIs,
// so one client shape works for every one. Add new providers here.
const PROVIDERS = {
  deepseek: {
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    apiKeyEnv: "LLM_API_KEY",
  },
  kimi: {
    baseURL: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2-0905-preview",
    apiKeyEnv: "LLM_API_KEY",
  },
};

export function makeReviewer({ provider = "deepseek", model, apiKey }) {
  const cfg = PROVIDERS[provider];
  if (!cfg) {
    throw new Error(
      `Unknown provider "${provider}". Supported: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }

  const client = new OpenAI({
    apiKey: apiKey || process.env[cfg.apiKeyEnv],
    baseURL: cfg.baseURL,
  });

  const SYSTEM = `You are a precise, senior code reviewer. Review ONLY the provided diff.

Return ONLY valid JSON, no prose, no markdown fences:
{"comments":[{"path":"<file path>","line":<line number in the NEW file>,"severity":"nit|warning|issue","body":"<concise, actionable comment>"}]}

Rules:
- "issue" = bug, security flaw, data loss, or clear correctness problem. Reserve it for things that SHOULD block merge.
- "warning" = likely problem, risky pattern, missing error handling.
- "nit" = style/readability. Use sparingly.
- Only comment on lines that are ADDED or MODIFIED in the diff (lines starting with +).
- "line" must be the line number in the new version of the file.
- If nothing is worth flagging, return {"comments":[]}.
- Do not invent issues. No comment is better than a noisy one.`;

  return async function review(files) {
    // files: [{ path, patch }]
    const all = [];
    for (const f of files) {
      if (!f.patch) continue; // binary / too-large files have no patch
      const res = await client.chat.completions.create({
        model: model || cfg.defaultModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `File: ${f.path}\n\nUnified diff:\n${f.patch}` },
        ],
      });
      const raw = res.choices[0]?.message?.content ?? "{}";
      let parsed;
      try {
        parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      } catch {
        console.warn(`Could not parse model output for ${f.path}, skipping.`);
        continue;
      }
      for (const c of parsed.comments ?? []) {
        all.push({ ...c, path: c.path || f.path });
      }
    }
    return all;
  };
}
