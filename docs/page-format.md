# Page format

Every page has a title, an optional subtitle, and a list of blocks:

```json
{
  "title": "PR #412 — Retry handling",
  "subtitle": "optional line under the title",
  "blocks": []
}
```

## `md`

Render Markdown, including headings, tables, lists, and code fences. Raw HTML
is displayed as text and cannot execute. Links and images may use `http:`,
`https:`, `mailto:`, relative, or fragment destinations. Destinations that use
other schemes, including `javascript:` and `data:`, render without a clickable
link or loaded image.

```json
{"type": "md", "text": "## Verdict\n\nTwo blockers."}
```

## `ref`

Load content without placing it in the page JSON. References render as
collapsed sections, and unified diffs receive syntax coloring.

```json
{"type": "ref", "cmd": "gh pr diff 412", "label": "Diff"}
{"type": "ref", "file": "src/retry.ts"}
```

Provide `cmd` or `file`, but not both.

Only use `ref` blocks from sources you trust. A `file` reference can read any
file available to the `viz` process, including paths outside the current
repository. A `cmd` reference runs a local program. When remote mode is active,
the resolved content is included in the page uploaded to the configured server.
The allowlist reduces accidental command execution; it is not a sandbox.

`cmd` runs one program without a shell. Pipes, redirects, and `&&` are rejected.
The program must be on this allowlist:

```text
gh git cat head tail ls rg grep find wc diff
```

Add machine-specific programs persistently with:

```bash
viz config allow gh-axi jira-axi confluence-axi slack-axi
```

This command adds programs to the saved list. Use `viz config allow disable` to
remove all saved additions. `VIZ_ALLOW="foo,bar"` adds programs for one
environment without changing the config file.

Output is limited to 2,000 lines or 200 KB, and commands time out after 30
seconds. A failed reference appears as visible text in the page rather than
stopping the run. Some tools return multiline content as one escaped string;
`viz` detects and unpacks that format.

## `diagram`

Render a [Mermaid](https://mermaid.js.org) diagram.

```json
{
  "type": "diagram",
  "label": "Retry flow",
  "text": "sequenceDiagram\n  C->>S: issueCard()\n  S->>V: POST /cards\n  V--xS: timeout"
}
```

Useful diagram types include `sequenceDiagram` for calls across services,
`flowchart` for decision paths, `stateDiagram-v2` for lifecycles, and
`erDiagram` for schemas.

Mermaid loads from a CDN to avoid adding several megabytes to every page. A page
with a diagram needs network access the first time it opens. If Mermaid cannot
load, the diagram source remains visible as text. Pages without diagrams work
fully offline.

## `table`

Show structured rows and columns. Use this instead of a Markdown table when the
table is a distinct content block that themes should style directly.

```json
{
  "type": "table",
  "label": "Release checks",
  "columns": ["Check", "Target", "Result"],
  "rows": [
    ["API suite", "42 passing", "Ready"],
    ["Migration", "Under 5 minutes", "3m 18s"]
  ]
}
```

`columns` and `rows` must be non-empty. Every row must contain exactly one
string cell per column. Empty strings are allowed for intentionally blank cells.
Wide tables scroll horizontally on narrow screens.

## `decide`

Ask a question. This is the only interactive block.

```json
{
  "type": "decide",
  "id": "c1",
  "title": "Retries reuse a single request key",
  "body": "Optional Markdown explanation.",
  "options": ["Raise it", "Ask the author", "Not a problem"],
  "recommend": "Ask the author",
  "severity": "blocker",
  "where": "src/retry.ts:88"
}
```

Each question carries two free-text inputs, and they do different jobs:

| Input | Use it to | Comes back as |
|---|---|---|
| **Something else** | reject every option and write your own | `c1: <your text>` |
| **Additional context** | keep an option and say why | `c1: Ask the author — context: <your text>` |

The context box never counts as an answer on its own. A question stays
unanswered until an option is picked, so a note cannot make the progress counter
lie.

After answering at least one question, you can submit or copy a partial answer
set. Unanswered IDs are omitted from the result. Use **Show next unanswered** to
open a collapsed group and move to another pending question.

Every `id` must be unique across the page, including inside groups. Prefix IDs
when a page covers several subjects, such as `p412-c1` and `p77-c1`.

## `cards`

Show a grid of small summary tiles.

```json
{
  "type": "cards",
  "items": [
    {
      "title": "#412 retry handling",
      "badge": "hold",
      "meta": "example-service · @alice · 2 blockers",
      "href": "https://github.com/example/repo/pull/412"
    }
  ]
}
```

Only `title` is required. The standard badge values are `blocker`, `nitpick`,
`easy`, `complex`, `approve`, `hold`, and `draft`. Other values use the accent
color. A card with a safe `href` opens its link in a new tab. Card and group
links use the same allowed destinations as Markdown links; unsafe optional links
are omitted without hiding the block contents.

## `group`

Wrap blocks in a collapsible section.

```json
{
  "type": "group",
  "label": "PR #412 — retry handling",
  "badge": "hold",
  "meta": "example-service · @alice · TASK-1559",
  "href": "https://github.com/example/repo/pull/412",
  "open": false,
  "blocks": [{"type": "md", "text": "..."}]
}
```

- `blocks` accepts any block except another `group`.
- `open` defaults to `true`.
- **Show next unanswered** finds and opens collapsed groups that contain pending questions.
- References, decisions, and `--echo` work normally inside groups.
