import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { resolveTheme, THEMES, validateThemeChoice } from "../src/themes.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

describe("themes", () => {
  test("resolves named, independent, and mode-aware random choices", () => {
    assert.equal(resolveTheme("classic").colorMode, "system");
    assert.deepEqual(resolveTheme("classic").appearances, ["light", "dark"]);
    assert.equal(resolveTheme("rainbow").colorMode, "independent");
    assert.deepEqual(resolveTheme("rainbow").appearances, ["independent"]);
    assert.equal(resolveTheme("high-fantasy").artVariants, 5);
    assert.equal(resolveTheme("adventurer-handbook").artVariants, 6);
    assert.equal(resolveTheme("dark-cathedral").artVariants, 6);
    assert.equal(resolveTheme("swamp").artVariants, 6);

    assert.deepEqual(
      [resolveTheme("random", () => 0), resolveTheme("random_system", () => 0)]
        .map(({ name, colorMode, mermaidTheme }) => ({ name, colorMode, mermaidTheme })),
      [
        { name: "classic", colorMode: "system", mermaidTheme: "system" },
        { name: "classic", colorMode: "system", mermaidTheme: "system" },
      ],
    );
    assert.deepEqual(
      [resolveTheme("random_light", () => 0.999), resolveTheme("random_dark", () => 0.999)]
        .map(({ name, colorMode, mermaidTheme }) => ({ name, colorMode, mermaidTheme })),
      [
        { name: "arcade", colorMode: "light", mermaidTheme: "default" },
        { name: "arcade", colorMode: "dark", mermaidTheme: "dark" },
      ],
    );
    assert.deepEqual(
      (({ name, colorMode, mermaidTheme }) => ({ name, colorMode, mermaidTheme }))(
        resolveTheme("random", () => 0.999),
      ),
      { name: "space-command", colorMode: "independent", mermaidTheme: "dark" },
    );
    assert.throws(
      () => validateThemeChoice("sparkles"),
      /random_light, random_dark, random_system/,
    );
  });

  test("each registered appearance has a palette without enforcing one visual formula", async () => {
    for (const theme of THEMES) {
      const css = await readFile(path.join(ROOT, "templates/themes", theme.stylesheet), "utf8");
      for (const appearance of theme.appearances) {
        assert.match(
          css,
          new RegExp(`:root\\[data-theme="${theme.name}"\\]\\[data-theme-mode="${appearance}"\\]`),
        );
      }
      for (const variable of ["bg", "surface", "border", "text", "accent", "measure"]) {
        assert.match(css, new RegExp(`--${variable}:`), `${theme.name} is missing --${variable}`);
      }
    }
  });
});
