import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeComment } from "../src/reviewer.js";

test("normalizeComment passes through a well-formed comment", () => {
  const out = normalizeComment(
    { path: "a.js", line: 5, severity: "issue", body: "boom" },
    "fallback.js",
  );
  assert.deepEqual(out, { path: "a.js", line: 5, severity: "issue", body: "boom" });
});

test("normalizeComment falls back to the file path when path is missing", () => {
  const out = normalizeComment({ line: 1, severity: "nit", body: "x" }, "fallback.js");
  assert.equal(out.path, "fallback.js");
});

test("normalizeComment coerces a numeric-string line", () => {
  const out = normalizeComment({ path: "a.js", line: "7", severity: "nit", body: "x" }, "f.js");
  assert.equal(out.line, 7);
});

test("normalizeComment clamps an unknown severity to warning", () => {
  const out = normalizeComment(
    { path: "a.js", line: 1, severity: "critical", body: "x" },
    "f.js",
  );
  assert.equal(out.severity, "warning");
});

test("normalizeComment lowercases a valid severity", () => {
  const out = normalizeComment({ path: "a.js", line: 1, severity: "ISSUE", body: "x" }, "f.js");
  assert.equal(out.severity, "issue");
});

test("normalizeComment trims the body", () => {
  const out = normalizeComment({ path: "a.js", line: 1, severity: "nit", body: "  hi  " }, "f.js");
  assert.equal(out.body, "hi");
});

test("normalizeComment rejects unusable comments", () => {
  // no path available
  assert.equal(normalizeComment({ line: 1, severity: "nit", body: "x" }, ""), null);
  // non-numeric line
  assert.equal(normalizeComment({ path: "a.js", line: "nope", body: "x" }, "f.js"), null);
  // line below 1
  assert.equal(normalizeComment({ path: "a.js", line: 0, body: "x" }, "f.js"), null);
  // empty body
  assert.equal(normalizeComment({ path: "a.js", line: 1, body: "   " }, "f.js"), null);
  // missing body
  assert.equal(normalizeComment({ path: "a.js", line: 1 }, "f.js"), null);
});
