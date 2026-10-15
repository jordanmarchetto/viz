import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePage, ValidationError } from "../src/schema.ts";

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
