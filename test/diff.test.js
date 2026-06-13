import { test } from "node:test";
import assert from "node:assert/strict";
import { buildValidLineMap, partitionComments } from "../src/diff.js";

const DIFF = `diff --git a/foo.js b/foo.js
index 000..111 100644
--- a/foo.js
+++ b/foo.js
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
+const d = 4;
diff --git a/bar.js b/bar.js
index 222..333 100644
--- a/bar.js
+++ b/bar.js
@@ -10,2 +10,2 @@
-const old = 1;
+const renamed = 1;
 const keep = 2;`;

test("buildValidLineMap collects only added lines in the new file", () => {
  const map = buildValidLineMap(DIFF);
  assert.deepEqual([...map.get("foo.js")].sort((a, b) => a - b), [2, 4]);
  // The removed line doesn't consume a new-file number, so the added
  // (renamed) line sits at new-file line 10.
  assert.deepEqual([...map.get("bar.js")], [10]);
});

test("buildValidLineMap excludes context and removed lines", () => {
  const map = buildValidLineMap(DIFF);
  // Line 1 (context) and line 3 (context) are not valid comment targets.
  assert.ok(!map.get("foo.js").has(1));
  assert.ok(!map.get("foo.js").has(3));
});

test("buildValidLineMap handles a newly added file", () => {
  const added = `diff --git a/new.js b/new.js
new file mode 100644
index 000..111
--- /dev/null
+++ b/new.js
@@ -0,0 +1,2 @@
+line one
+line two`;
  const map = buildValidLineMap(added);
  assert.deepEqual([...map.get("new.js")].sort((a, b) => a - b), [1, 2]);
});

test("partitionComments splits on whether the line is in the diff", () => {
  const map = buildValidLineMap(DIFF);
  const comments = [
    { path: "foo.js", line: 2, severity: "issue", body: "on a real line" },
    { path: "foo.js", line: 99, severity: "nit", body: "off-diff line" },
    { path: "unknown.js", line: 1, severity: "warning", body: "unknown file" },
  ];
  const { inline, orphan } = partitionComments(comments, map);
  assert.equal(inline.length, 1);
  assert.equal(inline[0].line, 2);
  assert.equal(orphan.length, 2);
});

test("partitionComments returns empty arrays for no input", () => {
  const { inline, orphan } = partitionComments([], new Map());
  assert.deepEqual(inline, []);
  assert.deepEqual(orphan, []);
});
