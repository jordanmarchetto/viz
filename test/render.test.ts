import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderPage } from "../src/render.ts";
import type { Page } from "../src/schema.ts";
import { resolveTheme, themeByName } from "../src/themes.ts";

async function render(blocks: Page["blocks"]): Promise<string> {
  return renderPage({ title: "Security test", blocks }, { mode: "detached" });
}

describe("safe page rendering", () => {
  test("shows raw Markdown HTML as text instead of active markup", async () => {
    const html = await render([{
      type: "md",
      text: "<script>alert('x')</script>\n\n<img src=x onerror=alert('x')>",
    }]);

    assert.match(html, /&lt;script&gt;alert\('x'\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\((?:'|&#39;)x(?:'|&#39;)\)&gt;/);
    assert.doesNotMatch(html, /<script>alert\('x'\)<\/script>/);
    assert.doesNotMatch(html, /<img src=x onerror=/);
  });

  test("renders unsafe Markdown links and images without destinations", async () => {
    const html = await render([{
      type: "md",
      text: "[script](javascript:alert(1)) [data](data:text/html,boom) ![image](data:image/svg+xml,boom)",
    }]);

    assert.match(html, /script/);
    assert.match(html, /data/);
    assert.match(html, /image/);
    assert.doesNotMatch(html, /href="(?:javascript|data):/);
    assert.doesNotMatch(html, /src="data:/);
  });

  test("keeps supported Markdown destinations clickable", async () => {
    const html = await render([{
      type: "md",
      text: [
        "[https](https://example.test)",
        "[http](http://example.test)",
        "[relative](docs/page.html)",
        "[fragment](#part)",
        "[email](mailto:dev@example.test)",
        "![relative image](images/chart.png)",
      ].join(" "),
    }]);

    for (const destination of [
      "https://example.test",
      "http://example.test",
      "docs/page.html",
      "#part",
      "mailto:dev@example.test",
    ]) {
      assert.match(html, new RegExp(`href="${destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    }
    assert.match(html, /src="images\/chart\.png"/);
  });

  test("renders typed tables and escapes cell content", async () => {
    const html = await render([{
      type: "table",
      label: "Ability scores",
      columns: ["Ability", "Score"],
      rows: [["Strength", "18"], ["Dexterity", "<script>alert(1)</script>"]],
    }]);

    assert.match(html, /<figure class="data-table">/);
    assert.match(html, /<figcaption>Ability scores<\/figcaption>/);
    assert.match(html, /<th scope="col">Ability<\/th>/);
    assert.match(html, /<td>Strength<\/td><td>18<\/td>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  });

  test("omits unsafe typed links and protects safe new-tab links", async () => {
    const html = await render([
      {
        type: "cards",
        items: [
          { title: "Unsafe card", href: "javascript:alert(1)" },
          { title: "Safe card", href: "https://example.test/card" },
        ],
      },
      {
        type: "group",
        label: "Unsafe group",
        href: "data:text/html,boom",
        blocks: [{ type: "md", text: "Group contents" }],
      },
      {
        type: "group",
        label: "Safe group",
        href: "http://example.test/group",
        blocks: [{ type: "md", text: "Safe contents" }],
      },
    ]);

    assert.match(html, /<div class="card">[\s\S]*Unsafe card[\s\S]*<\/div>/);
    assert.doesNotMatch(html, /href="javascript:/);
    assert.doesNotMatch(html, /href="data:/);
    assert.match(html, /href="https:\/\/example\.test\/card" target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /href="http:\/\/example\.test\/group" target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /Unsafe group/);
    assert.match(html, /Group contents/);
  });

  test("embeds every theme and renders the switcher on display-only pages", async () => {
    const html = await renderPage({
      title: "Themed",
      blocks: [{ type: "diagram", text: "flowchart LR\n  A-->B" }],
    }, { mode: "detached", theme: themeByName("storybook"), artVariant: 4 });

    assert.match(html, /<html lang="en" data-theme="storybook" data-theme-mode="system" data-art-variant="4">/);
    assert.match(html, /:root\[data-theme="classic"\]/);
    assert.match(html, /:root\[data-theme="storybook"\]/);
    assert.match(html, /:root\[data-theme="unicorn"\]/);
    assert.match(html, /:root\[data-theme="arcade"\]/);
    assert.match(html, /:root\[data-theme="rainbow"\]/);
    assert.match(html, /:root\[data-theme="zine"\]/);
    assert.match(html, /:root\[data-theme="high-fantasy"\]/);
    assert.match(html, /:root\[data-theme="adventurer-handbook"\]/);
    assert.match(html, /data:image\/svg\+xml;base64,/);
    assert.doesNotMatch(html, /\{\{asset:/);
    assert.match(html, /:root\[data-theme="inferno"\]/);
    assert.match(html, /:root\[data-theme="dark-cathedral"\]/);
    assert.match(html, /:root\[data-theme="swamp"\]/);
    assert.match(html, /:root\[data-theme="space-command"\]/);
    assert.match(html, /<span class="theme-art header-art" aria-hidden="true"><\/span>/);
    assert.match(html, /<span class="theme-art content-art" aria-hidden="true"><\/span>/);
    assert.match(html, /<label class="theme-control">/);
    assert.match(html, /<option value="classic:light">Classic \[light\]<\/option>/);
    assert.match(html, /<option value="classic:dark">Classic \[dark\]<\/option>/);
    assert.match(html, /<option value="storybook:light">Storybook \[light\]<\/option>/);
    assert.match(html, /<option value="storybook:dark">Storybook \[dark\]<\/option>/);
    assert.match(html, /<option value="arcade:light">Arcade \[light\]<\/option>/);
    assert.match(html, /<option value="arcade:dark">Arcade \[dark\]<\/option>/);
    assert.match(html, /<option value="rainbow:independent">Rainbow<\/option>/);
    assert.match(html, /<option value="zine:independent">Zine<\/option>/);
    assert.match(html, /<option value="high-fantasy:independent">High Fantasy<\/option>/);
    assert.match(html, /<option value="adventurer-handbook:independent">Adventurer Handbook<\/option>/);
    assert.match(html, /<option value="inferno:independent">Inferno<\/option>/);
    assert.match(html, /<option value="dark-cathedral:independent">Dark Cathedral<\/option>/);
    assert.match(html, /<option value="swamp:independent">Swamp<\/option>/);
    assert.match(html, /<option value="space-command:independent">Space Command<\/option>/);
    assert.doesNotMatch(html, /(?:rainbow|zine|high-fantasy|adventurer-handbook|inferno|dark-cathedral|swamp|space-command):(?:light|dark)/);
    assert.match(html, /<option value="__surprise__">Surprise me<\/option>/);
    assert.match(html, /<pre class="mermaid" data-source="flowchart LR/);
    assert.match(html, /window\.VIZ_MERMAID = mermaid/);
    assert.match(html, /themeSelect\.addEventListener\("change"/);
    assert.match(html, /"theme":"storybook","themeMode":"system"/);
    assert.match(html, /"name":"rainbow","colorMode":"independent","appearances":\["independent"\]/);
    assert.doesNotMatch(html, /<button class="primary">/);
  });

  test("selects a forced random appearance before client JavaScript runs", async () => {
    const html = await renderPage({ title: "Forced", blocks: [] }, {
      mode: "detached",
      theme: resolveTheme("random_dark", () => 0.3),
    });

    assert.match(html, /data-theme="storybook" data-theme-mode="dark"/);
    assert.match(html, /<option value="storybook:dark" selected>Storybook \[dark\]<\/option>/);
  });

  test("places the theme selector before decision actions", async () => {
    const html = await renderPage({
      title: "Decision",
      blocks: [{ type: "decide", id: "q1", title: "Choose", options: ["A", "B"] }],
    }, { mode: "blocking", submitUrl: "/submit" });

    assert.match(
      html,
      /<label class="theme-control">[\s\S]*<\/label>\s*<button class="secondary next-unanswered">Show next unanswered<\/button>\s*<button class="primary" disabled>Submit<\/button>/,
    );
    assert.match(html, /<span class="progress"><\/span>/);
    assert.match(html, /submitBtn\.disabled = done === 0/);
    assert.match(html, /nextBtn\.addEventListener\("click", revealNext\)/);
    assert.match(html, /\.filter\(\(id\) => answers\[id\]\)/);
  });

  test("includes document-level browser protections", async () => {
    const html = await render([{ type: "md", text: "Protected" }]);

    assert.match(html, /<meta name="referrer" content="no-referrer">/);
    assert.match(html, /<meta http-equiv="Content-Security-Policy"\s+content="object-src 'none'; base-uri 'none'; form-action 'none'">/);
  });
});
