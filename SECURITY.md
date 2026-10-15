# Security policy

## Report a vulnerability

Do not open a public issue for a suspected vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/jordanmarchetto/viz/security/advisories/new) to share the affected version, reproduction steps, impact, and any suggested mitigation. You will receive a response through the advisory.

## Trust boundary

Only run page descriptions from sources you trust. A `ref` block can read files available to the `viz` process and execute allowlisted programs. Remote mode uploads the rendered page and resolved reference content to the configured server. See the [README security guidance](README.md#security).
