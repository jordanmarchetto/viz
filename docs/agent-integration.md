# Teach an LLM to use viz

An LLM does not need a special tool integration to use `viz`. Add instructions
to the agent's system prompt, repository instructions, or skill file that tell
it when to run the CLI and how to construct the page JSON.

## Instruction template

Copy this section into the instructions for an agent or skill, then adjust the
trigger to match its job:

````markdown
## Browser output with viz

Use `viz` when it is available and the output benefits from a readable browser
page. Good uses include long structured reports, supporting files or diffs, and
several related decisions. Keep short answers in the terminal.

Check availability with `command -v viz`. If it is unavailable, use normal
terminal or chat output without treating that as an error.

Use a detached page for content the user reads asynchronously:

```bash
viz --detach <<'VIZ'
{"title":"<title>","blocks":[{"type":"md","text":"<summary>"}]}
VIZ
```

Use a blocking page when answering the questions is the next required step:

```bash
viz <<'VIZ'
{
  "title": "<title>",
  "blocks": [
    {
      "type": "decide",
      "id": "q1",
      "title": "<question>",
      "options": ["<option one>", "<option two>"],
      "recommend": "<option one>"
    }
  ]
}
VIZ
```

Follow these rules:

- Quote the heredoc delimiter as `<<'VIZ'`. This prevents the shell from
  interpreting backticks and `$` inside the JSON.
- Use `ref` blocks for large files, diffs, and command output. Do not copy that
  content into an `md` block.
- Use `--detach` for reference pages. Omit it only when the agent has finished
  its other work and must wait for the user's answers.
- Treat `abandoned: ...` as no answer. Never select the recommended options on
  the user's behalf.
- If `viz` reports invalid JSON, fix it and retry once. If it still fails, fall
  back to terminal or chat output.
- Share every `file:` and `page:` location printed by `viz` with the user.
- After a blocking page returns, record the answers briefly in the conversation. A submission may omit unanswered decision IDs.
- Do not place secrets or credentials in a page. Pages remain on disk and may be
  uploaded when remote mode is configured.

During an SSH session, where `SSH_CONNECTION`, `SSH_CLIENT`, or `SSH_TTY` is
set, use `viz` only when `viz config show` reports a non-null remote
configuration. Otherwise, use terminal or chat output.
````

See the [page format reference](page-format.md) for every block type.

## Choose the mode deliberately

Use detached mode when the page supplements the conversation. Examples include
a PR review, ticket summary, dashboard, or architecture explanation. The agent
continues after rendering the page, and decisions on the page use a **Copy
answers** button.

Use blocking mode when the page replaces a question-and-answer turn. Examples
include a design interview or approval checkpoint. Start any independent work
before calling `viz`, because the process waits until the user submits answers
or the timeout expires. The user can submit after answering at least one
decision; unanswered IDs do not appear in the result.

## Keep large content out of model context

A `ref` block tells `viz` how to retrieve content locally:

```json
{"type":"ref","label":"Full diff","cmd":"gh pr diff 412"}
```

The LLM only writes the short reference. `viz` runs the command and places its
output in the page. This reduces context use and avoids asking the model to copy
hundreds of lines into JSON.

Commands run without a shell and must be allowlisted. See
[`ref` blocks](page-format.md#ref) for the defaults and configuration.

## Example skill patterns

### Reference page

Use this pattern for a report that also remains in terminal or chat output:

```bash
if command -v viz >/dev/null 2>&1; then
  viz --detach <<'VIZ'
{
  "title": "PR #412 — Retry handling",
  "blocks": [
    {"type":"md","text":"## Verdict: hold\n\nTwo concerns need review."},
    {"type":"ref","label":"Full diff","cmd":"gh pr diff 412"}
  ]
}
VIZ
fi
```

### Decision page

Use this pattern when the agent cannot continue until the user decides:

```bash
viz <<'VIZ'
{
  "title": "Retry behavior",
  "blocks": [
    {
      "type": "decide",
      "id": "retry",
      "title": "Which request key should retries use?",
      "body": "Reusing the key prevents duplicate work. A new key treats every attempt as new work.",
      "options": ["Reuse the request key", "Generate a new key"],
      "recommend": "Reuse the request key"
    }
  ]
}
VIZ
```

The command returns one compact line that the agent can use directly:

```text
retry: Reuse the request key
```
