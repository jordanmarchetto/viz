# Remote pages

Local mode is the default and does not require a persistent server. Configure
[`viz-server`](https://github.com/jordanmarchetto/viz-server) only when the page
must be accessible from another machine, such as during an SSH session.

## Configure a server

Run the interactive configuration command:

```bash
viz config remote
# Server URL: http://server.home:5008
# Shared token: [input is hidden]
```

This writes `~/.config/viz/config.json` with mode `0600`:

```json
{
  "remote": {
    "serverUrl": "http://server.home:5008",
    "token": "shared-secret"
  }
}
```

You can edit the file directly. Environment variables take precedence when
both are set:

```bash
export VIZ_SERVER_URL=http://127.0.0.1:5008
export VIZ_TOKEN=shared-secret
```

Inspect the effective configuration without printing the secret, or disable the
file setting:

```bash
viz config show
viz config disable
```

## Remote behavior

With remote mode configured, `viz` saves a local copy and uploads the page.

- Detached pages print the local and remote links, then exit.
- Blocking pages print both links to stderr, wait for the first answer submitted
  in the remote browser, print the answers, and exit.
- Empty result requests and brief network failures reconnect until the overall
  timeout expires.

A detached remote page prints:

```text
file: file:///path/to/scratch/viz/2026-09-30-1650-pr-412/page.html
page: https://viz.example.com/pages/550e8400-e29b-41d4-a716-446655440000
```

A blocking remote page initially prints:

```text
viz: local copy — file:///path/to/scratch/viz/2026-09-30-1650-pr-412/page.html
viz: waiting for answers — https://viz.example.com/pages/550e8400-e29b-41d4-a716-446655440000
```

A remote failure reports the saved local copy and exits nonzero instead of
silently treating the local page as success. Use `--local` for a one-time bypass.
`--print` always writes HTML to stdout without uploading.
