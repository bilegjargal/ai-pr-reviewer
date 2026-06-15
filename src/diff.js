import parseDiff from "parse-diff";

// Build a map of "path" -> Map(newLineNumber -> source line text) for lines
// that are valid comment targets, i.e. added/modified in the new file. GitHub
// rejects review comments that don't sit on a diff line, so we filter against
// this before posting. The line text lets the fix prompt quote the actual code
// at each issue so the downstream agent matches by content, not a bare number.
// (A Map answers .has() just like a Set, so position checks are unchanged.)
export function buildValidLineMap(unifiedDiff) {
  const files = parseDiff(unifiedDiff);
  const valid = new Map(); // path -> Map(lineNumber -> source line text)

  for (const file of files) {
    const path = file.to && file.to !== "/dev/null" ? file.to : file.from;
    if (!path) continue;
    const lines = valid.get(path) ?? new Map();
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        // 'add' lines have a ln in the new file; .content keeps the leading
        // '+' marker, so slice it off to recover the original source text.
        if (change.type === "add") lines.set(change.ln, change.content.slice(1));
      }
    }
    valid.set(path, lines);
  }
  return valid;
}

// Split comments into ones that can be posted as inline review comments and
// ones that can't (line not in diff) - those become a summary fallback.
export function partitionComments(comments, validMap) {
  const inline = [];
  const orphan = [];
  for (const c of comments) {
    const lines = validMap.get(c.path);
    if (lines && lines.has(c.line)) inline.push(c);
    else orphan.push(c);
  }
  return { inline, orphan };
}
