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
      if (isIgnored(f.path)) {
        console.info(`Skipping ${f.path} (generated/vendored — not worth LLM tokens).`);
        continue;
      }
      if (f.patch.length > MAX_PATCH_CHARS) {
        console.info(
          `Skipping ${f.path} (patch is ${f.patch.length} chars > ${MAX_PATCH_CHARS} cap).`,
        );
        continue;
      }
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
        const norm = normalizeComment(c, f.path);
        if (norm) all.push(norm);
      }
    }
    return all;
  };
}

// Skip files whose diffs are machine-generated, vendored, or otherwise not
// worth spending LLM tokens on. These are the usual suspects that quietly
// dominate a PR's token count (a single lock-file bump can be 10k+ lines).
const IGNORE_PATTERNS = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$/,
  /(^|\/)(Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/,
  /(^|\/)(dist|build|out|vendor|node_modules|\.next|coverage)\//,
  /\.(min\.js|min\.css|map|snap)$/,
  /(^|\/)__snapshots__\//,
];

export function isIgnored(path) {
  return IGNORE_PATTERNS.some((re) => re.test(path));
}

// Hard cap on a single file's patch size. Anything bigger is almost certainly
// generated and would burn tokens with little review value. ~16k chars ≈ a few
// thousand tokens — generous for hand-written changes, tight for bundles.
const MAX_PATCH_CHARS = 16_000;

const SEVERITIES = new Set(["nit", "warning", "issue"]);

// Coerce a raw model comment into a well-formed one, or null if it's unusable.
// Models occasionally return out-of-spec severities or non-numeric line values;
// we clamp those rather than letting them silently drop out downstream.
export function normalizeComment(c, fallbackPath) {
  const path = c.path || fallbackPath;
  const line = Number(c.line);
  const body = typeof c.body === "string" ? c.body.trim() : "";
  if (!path || !Number.isInteger(line) || line < 1 || !body) return null;

  let severity = String(c.severity ?? "").toLowerCase();
  if (!SEVERITIES.has(severity)) {
    console.warn(`Unexpected severity "${c.severity}" for ${path}:${line}; treating as "warning".`);
    severity = "warning";
  }
  return { path, line, severity, body };
}
