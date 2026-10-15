# CLI reference

## Commands

```text
viz test [options]                       render the built-in sample page
viz themes                               list built-in themes
viz config <remote|show|disable|theme>   manage configuration
```

`viz test` exercises representative content, cards, a group, a Mermaid diagram,
and a decision without reading stdin. It defaults to detached mode so it does
not wait for an answer. Normal options still apply, including `--open`,
`--local`, `--theme`, `--wait`, and `--print`.

## Options

```text
--open              open the browser (default: only print the link)
--local             bypass configured remote mode for this invocation
--theme <choice>    use a named theme or random[_light|_dark|_system]
--detach            render and exit without waiting for answers
--wait              wait even if the page has no decisions
--timeout <min>     how long to wait (default: 30)
--echo              also print a plain-text version of the page
--print             write HTML to stdout instead of writing a file
-h, --help          show command help
```

Run `viz themes` to list built-in themes and their color behavior. Set or remove
the default with `viz config theme <choice>` and `viz config theme disable`.
A choice can be a theme name, `random`, `random_light`, `random_dark`, or
`random_system`. Bare `random` includes every theme and preserves the chosen
theme's normal mode policy. The other random choices select only compatible
themes. `--theme` overrides `VIZ_THEME`, which overrides the configured default.
Generated pages also provide a footer selector that changes the open page
without modifying these defaults. See [Themes](themes.md).

`--echo` lets a calling tool preserve terminal output without generating the
same content twice. Reference output is not echoed because large files and diffs
would defeat that purpose.

## Output

A detached local page prints:

```text
page: file:///path/to/scratch/viz/2026-09-30-1650-pr-412/page.html
```

The `file://` URL is clickable in supported terminals.

A blocking page prints its locations to stderr. After submission, it prints
answered decision IDs to stdout. A partial submission omits unanswered IDs:

```text
c1: Ask the author
c2: Raise it as a blocker
```

On timeout, it prints:

```text
abandoned: nobody answered within 30 minutes
```

Invalid input goes to stderr with the exact failing path and exits with status
1:

```text
viz: blocks[2].recommend: must be one of ["Raise it","Ask the author"]
```

## Saved pages

Pages are written under `./scratch/viz/` when the working directory contains a
`scratch/` directory. Otherwise, they are written under `~/.viz/pages/`.

Blocking pages retain a detached copy that can still copy answers after the
local server exits. Remote pages are also stored by `viz-server`.

## Environment variables

| Variable | Purpose |
|---|---|
| `VIZ_OPEN=1` | Open pages by default without passing `--open` |
| `VIZ_ALLOW="foo,bar"` | Add programs to the `ref` command allowlist |
| `VIZ_THEME` | Override the theme with a name or mode-aware random choice |
| `VIZ_SERVER_URL` | Override the configured remote server URL |
| `VIZ_TOKEN` | Override the configured remote server token |

Set both `VIZ_SERVER_URL` and `VIZ_TOKEN` to enable remote mode through the
environment. See [Remote pages](remote-pages.md) for configuration details.
