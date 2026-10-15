/**
 * Turns a validated Page into one self-contained HTML file.
 *
 * Self-contained matters: detached pages are opened as file:// with no server,
 * so the CSS and JS have to be inlined rather than linked.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked, Renderer } from "marked";
import {
	flatten,
	type Block,
	type CardsBlock,
	type DecideBlock,
	type DiagramBlock,
	type GroupBlock,
	type Page,
	type RefBlock,
	type TableBlock,
} from "./schema.ts";
import { THEMES, type Theme } from "./themes.ts";

// ESM has no __dirname. import.meta.url is this file's URL; these two lines are
// the standard way to get back to a directory path.
const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(here, "..", "templates");
const THEME_ASSETS = path.join(TEMPLATES, "themes", "assets");

const ASSET_MIME_TYPES: Readonly<Record<string, string>> = {
	".svg": "image/svg+xml",
	".png": "image/png",
	".webp": "image/webp",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
};

/** Inline bundled theme images so local and remote pages remain self-contained. */
async function inlineThemeAssets(stylesheet: string): Promise<string> {
	const references = [...stylesheet.matchAll(/\{\{asset:([a-z0-9][a-z0-9/_-]*\.(?:svg|png|webp|jpe?g))\}\}/g)]
		.map((match) => match[1]);
	const assets = new Map<string, string>();

	await Promise.all([...new Set(references)].map(async (reference) => {
		const extension = path.extname(reference);
		const mimeType = ASSET_MIME_TYPES[extension];
		if (!mimeType) throw new Error(`unsupported theme asset type ${JSON.stringify(extension)}`);
		const contents = await readFile(path.join(THEME_ASSETS, reference));
		assets.set(reference, `data:${mimeType};base64,${contents.toString("base64")}`);
	}));

	return stylesheet.replace(/\{\{asset:([a-z0-9][a-z0-9/_-]*\.(?:svg|png|webp|jpe?g))\}\}/g, (_match, reference: string) => {
		const asset = assets.get(reference);
		if (!asset) throw new Error(`theme asset was not loaded: ${reference}`);
		return asset;
	});
}

export type Mode = "blocking" | "detached";

/** Escape text that lands in HTML, so a stray < in a diff cannot break the page. */
function esc(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Cheap unified-diff detection. Good enough to decide whether to colour it. */
function looksLikeDiff(text: string): boolean {
	return /^(diff --git |@@ |--- |\+\+\+ )/m.test(text);
}

/**
 * Colour a unified diff by line prefix. Hand-rolled rather than pulling in a
 * syntax highlighter: added, removed, and hunk lines are the only distinctions
 * that matter when you are scanning a diff.
 */
function renderDiff(text: string): string {
	const lines = text.split("\n").map((line) => {
		let kind = "";
		if (line.startsWith("+++") || line.startsWith("---")) kind = "meta";
		else if (line.startsWith("@@")) kind = "hunk";
		else if (line.startsWith("+")) kind = "add";
		else if (line.startsWith("-")) kind = "del";
		else if (line.startsWith("diff ") || line.startsWith("index ")) kind = "meta";
		return kind ? `<span class="${kind}">${esc(line)}</span>` : esc(line);
	});
	return `<pre class="diff">${lines.join("\n")}</pre>`;
}

const markdownRenderer = new Renderer();

/** Only destinations that cannot execute browser code are rendered as URLs. */
function isSafeUrl(destination: string): boolean {
	try {
		const url = new URL(destination.trim(), "https://viz.invalid/");
		return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
	} catch {
		return false;
	}
}

markdownRenderer.html = ({ text }) => esc(text);
markdownRenderer.link = function ({ href, title, text, tokens }) {
	if (!isSafeUrl(href)) return esc(text);
	const titleAttribute = title ? ` title="${esc(title)}"` : "";
	return `<a href="${esc(href)}"${titleAttribute}>${this.parser.parseInline(tokens)}</a>`;
};
markdownRenderer.image = ({ href, title, text }) => {
	if (!isSafeUrl(href)) return esc(text);
	const titleAttribute = title ? ` title="${esc(title)}"` : "";
	return `<img src="${esc(href)}" alt="${esc(text)}"${titleAttribute}>`;
};

function md(text: string): string {
	return marked.parse(text, { async: false, renderer: markdownRenderer }) as string;
}

function renderRef(block: RefBlock, resolved?: string): string {
	const source = block.cmd ?? block.file ?? "";
	const label = block.label ?? source;

	let body: string;
	if (resolved === undefined) {
		body = '<div class="placeholder">Not resolved.</div>';
	} else if (looksLikeDiff(resolved)) {
		body = renderDiff(resolved);
	} else {
		body = `<pre>${esc(resolved)}</pre>`;
	}

	const lineCount = resolved === undefined ? "" : `${resolved.split("\n").length} lines`;

	return `<details class="ref">
  <summary>${esc(label)}<span class="hint">${esc(lineCount || source)}</span></summary>
  ${body}
</details>`;
}

/** A severity chip. Shared by decide blocks, cards, and group headers. */
function chip(label: string): string {
	return `<span class="chip" data-severity="${esc(label.toLowerCase())}">${esc(label)}</span>`;
}

function renderTable(block: TableBlock): string {
	const head = block.columns.map((column) => `<th scope="col">${esc(column)}</th>`).join("");
	const rows = block.rows.map((row) => (
		`<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`
	)).join("\n");
	return `<figure class="data-table">
  ${block.label ? `<figcaption>${esc(block.label)}</figcaption>` : ""}
  <div class="table-scroll"><table>
    <thead><tr>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</figure>`;
}

function renderCards(block: CardsBlock): string {
	const items = block.items
		.map((item) => {
			const inner = `${item.badge ? chip(item.badge) : ""}
    <span class="card-title">${esc(item.title)}</span>
    ${item.meta ? `<span class="card-meta">${esc(item.meta)}</span>` : ""}`;
			// An <a> only when there is somewhere to go, so a plain card does not
			// advertise a click that does nothing.
			return item.href && isSafeUrl(item.href)
				? `<a class="card" href="${esc(item.href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
				: `<div class="card">${inner}</div>`;
		})
		.join("\n");

	return `<div class="cards">\n${items}\n</div>`;
}

function renderGroup(block: GroupBlock, refs: RefMap): string {
	const body = block.blocks.map((child) => renderBlock(child, refs)).join("\n");
	// `open` is an HTML boolean attribute: present means expanded. Default to
	// expanded, so a group only hides content when the page asked it to.
	const open = block.open === false ? "" : " open";
	const link = block.href && isSafeUrl(block.href)
		? `<a class="group-link" href="${esc(block.href)}" target="_blank" rel="noopener noreferrer">open \u2197</a>`
		: "";

	return `<details class="group"${open}>
  <summary>
    <span class="group-head">
      <span class="group-label">${esc(block.label)}</span>
      ${block.badge ? chip(block.badge) : ""}
      ${link}
    </span>
    ${block.meta ? `<span class="group-meta">${esc(block.meta)}</span>` : ""}
  </summary>
  <div class="group-body">
${body}
  </div>
</details>`;
}

function renderDecide(block: DecideBlock): string {
	const meta: string[] = [];
	if (block.severity) {
		meta.push(`<span class="chip" data-severity="${esc(block.severity.toLowerCase())}">${esc(block.severity)}</span>`);
	}
	if (block.where) meta.push(`<span class="where">${esc(block.where)}</span>`);

	const options = block.options
		.map((option) => {
			const recommended = option === block.recommend;
			return `<label class="option${recommended ? " selected" : ""}">
    <input type="radio" name="${esc(block.id)}" value="${esc(option)}">
    <span class="fill">${esc(option)}</span>
    ${recommended ? '<span class="rec">recommended</span>' : ""}
  </label>`;
		})
		.join("\n");

	const other = `<label class="option other">
    <input type="radio" name="${esc(block.id)}" value="__other__">
    <span class="fill">Something else
      <textarea placeholder="Type your own answer"></textarea>
    </span>
  </label>`;

	// Distinct from "Something else": the note qualifies a chosen option rather
	// than replacing it, so "option B, but only because X" survives the round
	// trip instead of being flattened to "option B".
	const note = `<label class="note">
    <span class="note-label">Additional context <span class="opt">optional</span></span>
    <textarea placeholder="Why this option? Anything else worth knowing."></textarea>
  </label>`;

	return `<section class="decide" data-id="${esc(block.id)}">
  ${meta.length ? `<div class="decide-meta">${meta.join("")}</div>` : ""}
  <h2>${esc(block.title)}</h2>
  ${block.body ? `<div class="body md">${md(block.body)}</div>` : ""}
  <div class="options">
${options}
${other}
  </div>
${note}
</section>`;
}

/**
 * Mermaid is loaded from a CDN rather than bundled. The library is several
 * megabytes; inlining it would put that in every page on disk. The tradeoff is
 * that diagrams need network access the first time a page is opened.
 *
 * If the script never loads, the <pre> keeps showing the diagram source, so a
 * page offline degrades to readable text rather than an empty box.
 */
const MERMAID_LOADER = `<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs";
window.VIZ_MERMAID = mermaid;
window.dispatchEvent(new Event("viz:mermaid-ready"));
</script>`;

function renderDiagram(block: DiagramBlock): string {
	return `<figure class="diagram">
  ${block.label ? `<figcaption>${esc(block.label)}</figcaption>` : ""}
  <pre class="mermaid" data-source="${esc(block.text)}">${esc(block.text)}</pre>
</figure>`;
}

function renderBlock(block: Block, refs: RefMap): string {
	switch (block.type) {
		case "md":
			return `<div class="md">${md(block.text)}</div>`;
		case "ref":
			return renderRef(block, refs.get(block));
		case "diagram":
			return renderDiagram(block);
		case "table":
			return renderTable(block);
		case "decide":
			return renderDecide(block);
		case "cards":
			return renderCards(block);
		case "group":
			return renderGroup(block, refs);
	}
}

/** Resolved ref output, keyed by the ref block itself. See resolve.ts. */
export type RefMap = Map<RefBlock, string>;

export interface RenderOptions {
	mode: Mode;
	/** Where the browser POSTs answers. Unused in detached mode. */
	submitUrl?: string;
	/** Resolved ref output, keyed by the ref block object. */
	refs?: RefMap;
	/** Resolved once per invocation so every local and remote copy matches. */
	theme?: Theme;
	/** Selects one curated decorative-art arrangement for the rendered page. */
	artVariant?: number;
}

export async function renderPage(page: Page, options: RenderOptions): Promise<string> {
	const theme = options.theme ?? THEMES[0];
	const artVariant = options.artVariant ?? 0;
	const [template, style, themeStyles, script] = await Promise.all([
		readFile(path.join(TEMPLATES, "page.html"), "utf8"),
		readFile(path.join(TEMPLATES, "style.css"), "utf8"),
		Promise.all(THEMES.map(async (item) => {
			const stylesheet = await readFile(path.join(TEMPLATES, "themes", item.stylesheet), "utf8");
			return inlineThemeAssets(stylesheet);
		})),
		readFile(path.join(TEMPLATES, "app.js"), "utf8"),
	]);

	const refs = options.refs ?? new Map<RefBlock, string>();
	const renderedBlocks = page.blocks.map((block) => renderBlock(block, refs));
	const artSlot = '<span class="theme-art content-art" aria-hidden="true"></span>';
	renderedBlocks.splice(Math.ceil(renderedBlocks.length / 2), 0, artSlot);
	const body = renderedBlocks.join("\n");

	// Flattened, so decide blocks nested in a group still get wired up.
	const flat = flatten(page.blocks);
	const decideIds = flat.filter((b): b is DecideBlock => b.type === "decide").map((b) => b.id);
	const hasDecisions = decideIds.length > 0;

	const themeOptions = THEMES.flatMap((item) => item.appearances.map((appearance) => {
		const selected = item.name === theme.name && theme.colorMode === appearance ? " selected" : "";
		const name = item.name
			.split("-")
			.map((word) => word[0].toUpperCase() + word.slice(1))
			.join(" ");
		const label = appearance === "independent" ? name : `${name} [${appearance}]`;
		return `<option value="${esc(`${item.name}:${appearance}`)}"${selected}>${esc(label)}</option>`;
	})).join("");
	const themeControl = `<label class="theme-control">
      <span>Theme</span>
      <select>${themeOptions}<option value="__surprise__">Surprise me</option></select>
    </label>`;
	const bar = `<div class="bar"><div class="bar-inner">
    ${hasDecisions ? '<span class="progress"></span>' : '<span class="footer-spacer"></span>'}
    ${themeControl}
    ${hasDecisions ? '<button class="secondary next-unanswered">Show next unanswered</button>' : ""}
    ${hasDecisions ? `<button class="primary" disabled>${options.mode === "detached" ? "Copy answers" : "Submit"}</button>` : ""}
  </div></div>`;

	const data = {
		mode: options.mode,
		submitUrl: options.submitUrl ?? null,
		decideIds,
		theme: theme.name,
		themeMode: theme.colorMode,
		themes: THEMES.map(({ name, colorMode, appearances, mermaidTheme }) => ({
			name,
			colorMode,
			appearances,
			mermaidTheme,
		})),
	};

	// Replace the closing tag delimiter so a string inside the data can never
	// end the <script> element early.
	const json = JSON.stringify(data).replace(/</g, "\\u003c");

	// One pass, not seven sequential replaces.
	//
	// Substituting placeholders one at a time rescans text that was just
	// inserted. A page showing a diff of this project contains the literal
	// string "{{BAR}}", so the later replace would hit that copy and leave the
	// real placeholder in the template. A single regex pass never re-examines
	// its own output.
	const values: Record<string, string> = {
		TITLE: esc(page.title),
		THEME: esc(theme.name),
		THEMEMODE: esc(theme.colorMode),
		ARTVARIANT: String(artVariant),
		STYLE: `${style}\n${themeStyles.join("\n")}`,
		HEADER: `<h1>${esc(page.title)}</h1>${page.subtitle ? `<p>${esc(page.subtitle)}</p>` : ""}<span class="theme-art header-art" aria-hidden="true"></span>`,
		BODY: body,
		BAR: bar,
		DATA: json,
		SCRIPT: script,
		EXTRA: flat.some((block) => block.type === "diagram") ? MERMAID_LOADER : "",
	};

	return template.replace(/\{\{([A-Z]+)\}\}/g, (match, key: string) => values[key] ?? match);
}
