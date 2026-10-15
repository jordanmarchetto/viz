# Development

## Project layout

```text
src/cli.ts       argument parsing, stdin, orchestration, and output
src/config.ts    local remote-server and theme configuration
src/themes.ts    built-in theme registry and selection
src/test-page.ts built-in representative page for `viz test`
src/remote.ts    page upload and remote answer collection
src/schema.ts    page format and validation
src/resolve.ts   safe resolution of ref blocks
src/render.ts    conversion from blocks to one HTML file
src/echo.ts      plain-text rendering for --echo
src/serve.ts     one-shot localhost server for blocking mode
src/open.ts      cross-platform browser launch
templates/       shared HTML, CSS, JavaScript, and theme layers inlined at render time
```

Pages are self-contained files. CSS and JavaScript are inlined so detached pages
work over `file://` without a running process.

Template placeholders are substituted in one pass. This prevents page content
that contains placeholder-like text from replacing the real template value.
`templates/style.css` provides a functional baseline. Files under
`templates/themes/` can override palettes, typography, spacing, block shape, and
composition. A theme may provide light and dark appearances or one independent
appearance. Curated images live under `templates/themes/assets/`; CSS references
them with `{{asset:path/to/file.svg}}`, and the renderer converts them to data
URLs. Generated pages therefore remain self-contained. A theme can declare an
`artVariants` count and style the generic `.theme-art` slot using the root
`data-art-variant` attribute. The CLI resolves that variant once per invocation,
so local, remote, and archive copies match. Every page embeds every built-in
theme; `templates/app.js` changes the root `data-theme` and `data-theme-mode`
values and rerenders Mermaid diagrams. These files are maintained by hand.

## Checks

Run the tests and TypeScript compiler before submitting a change:

```bash
npm test
npm run check
```

Render the demo page during visual changes:

```bash
npm run demo -- --detach --open
viz test --open
viz --theme storybook --detach --open < examples/theme-showcase.json
viz --theme random_dark --detach --open < examples/theme-showcase.json
```
