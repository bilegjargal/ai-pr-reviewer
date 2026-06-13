import parseDiff from "parse-diff";

// Build a set of "path:line" that are valid comment targets, i.e. lines that
// are added/modified in the new file. GitHub rejects review comments that
// don't sit on a diff line, so we filter against this before posting.
export function buildValidLineMap(unifiedDiff) {
  const files = parseDiff(unifiedDiff);
  const valid = new Map(); // path -> Set(lineNumbers)

  for (const file of files) {
    const path = file.to && file.to !== "/dev/null" ? file.to : file.from;
    if (!path) continue;
    const lines = valid.get(path) ?? new Set();
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        // 'add' and 'normal' (context) lines have a ln2 / ln in the new file.
        if (change.type === "add") lines.add(change.ln);
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
