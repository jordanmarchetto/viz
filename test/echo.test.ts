import assert from "node:assert/strict";
import { test } from "node:test";
import { echoPage } from "../src/echo.ts";

test("echoes table blocks as Markdown tables", () => {
  const output = echoPage({
    title: "Checks",
    blocks: [{
      type: "table",
      label: "Release status",
      columns: ["Check", "Result"],
      rows: [["API | worker", "passing"]],
    }],
  });

  assert.match(output, /### Release status/);
  assert.match(output, /\| Check \| Result \|/);
  assert.match(output, /\| API \\\| worker \| passing \|/);
});
