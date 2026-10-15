/**
 * Plain-text rendering of a page, for `--echo`.
 *
 * Exists so a skill can keep its terminal output *and* produce a page without
 * the model writing the same content twice. The model emits the page once;
 * viz prints a terminal version of it and opens the browser version.
 *
 * Ref output is deliberately not echoed. Dumping a 300-line diff back into the
 * terminal would undo the entire point of the page.
 */

import type { Block, DecideBlock, Page } from "./schema.ts";

export function echoPage(page: Page): string {
	const out: string[] = [];

	out.push(`## ${page.title}`);
	if (page.subtitle) out.push(`_${page.subtitle}_`);
	out.push("");

	out.push(...echoBlocks(page.blocks));

	return `${out.join("\n").trimEnd()}\n`;
}

function echoBlocks(blocks: Block[]): string[] {
	const out: string[] = [];

	for (const block of blocks) {
		if (block.type === "md") {
			out.push(block.text.trim(), "");
		} else if (block.type === "ref") {
			const source = block.cmd ?? block.file ?? "";
			out.push(`\u2192 ${block.label ?? source}  (in the page)`, "");
		} else if (block.type === "diagram") {
			out.push(`\u2192 ${block.label ?? "diagram"}  (in the page)`, "");
		} else if (block.type === "table") {
			if (block.label) out.push(`### ${block.label}`, "");
			const escapeCell = (cell: string) => cell.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
			out.push(`| ${block.columns.map(escapeCell).join(" | ")} |`);
			out.push(`| ${block.columns.map(() => "---").join(" | ")} |`);
			for (const row of block.rows) out.push(`| ${row.map(escapeCell).join(" | ")} |`);
			out.push("");
		} else if (block.type === "cards") {
			for (const item of block.items) {
				const tail = [item.badge?.toUpperCase(), item.meta].filter(Boolean).join(" \u00b7 ");
				out.push(`- ${item.title}${tail ? ` \u2014 ${tail}` : ""}`);
			}
			out.push("");
		} else if (block.type === "group") {
			const head = [block.badge?.toUpperCase(), block.meta].filter(Boolean).join(" \u00b7 ");
			out.push(`### ${block.label}${head ? `  \u2014 ${head}` : ""}`, "");
			out.push(...echoBlocks(block.blocks));
		} else {
			out.push(formatDecide(block), "");
		}
	}

	return out;
}

function formatDecide(block: DecideBlock): string {
	const head = [block.severity?.toUpperCase(), block.where].filter(Boolean).join(" · ");
	const lines: string[] = [];

	lines.push(`**${block.id}. ${block.title}**${head ? `  — ${head}` : ""}`);
	if (block.body) lines.push("", block.body.trim());

	const options = block.options
		.map((option) => `  - ${option}${option === block.recommend ? "  ← recommended" : ""}`)
		.join("\n");
	lines.push("", options);

	return lines.join("\n");
}
