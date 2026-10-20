import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePage, ValidationError } from "../src/schema.ts";

test("validates checklist as an optional boolean", () => {
  assert.equal(validatePage({
    title: "Checklist",
    checklist: true,
    blocks: [{ type: "md", text: "Work" }],
  }).checklist, true);

  assert.throws(
    () => validatePage({
      title: "Bad checklist",
      checklist: "yes",
      blocks: [{ type: "md", text: "Work" }],
    }),
    (error: unknown) => error instanceof ValidationError
      && /checklist: expected a boolean/.test(error.message),
  );
});

test("validates table dimensions and cell types", () => {
  const page = validatePage({
    title: "Table",
    blocks: [{
      type: "table",
      columns: ["Name", "Result"],
      rows: [["API", "passing"], ["Optional", ""]],
    }],
  });
  assert.equal(page.blocks[0]?.type, "table");

  assert.throws(
    () => validatePage({
      title: "Bad table",
      blocks: [{ type: "table", columns: ["Name", "Result"], rows: [["API"]] }],
    }),
    (error: unknown) => error instanceof ValidationError
      && /blocks\[0\]\.rows\[0\]: expected 2 string cells/.test(error.message),
  );
});
