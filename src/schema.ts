/**
 * The page description viz accepts on stdin, plus a hand-rolled validator.
 *
 * Hand-rolled rather than using a schema library so the error messages can name
 * the exact path that is wrong (`blocks[2].options`). A model reading that on
 * stderr can fix its input and retry without a human involved.
 */

export interface MdBlock {
	type: "md";
	text: string;
}

export interface RefBlock {
	type: "ref";
	/** Shell command whose output to show, e.g. "gh-axi pr diff 412". */
	cmd?: string;
	/** File to show. Relative paths resolve from the working directory. */
	file?: string;
	/** Optional heading for the collapsed section. */
	label?: string;
}

export interface DecideBlock {
	type: "decide";
	/** Short stable id. Echoed back in the output, so keep it terse: c1, q2. */
	id: string;
	title: string;
	body?: string;
	options: string[];
	/** Which option viz should pre-highlight. Must be one of `options`. */
	recommend?: string;
	/** Free-form marker shown as a coloured chip, e.g. "blocker", "nitpick". */
	severity?: string;
	/** Where in the codebase this is about, e.g. "src/retry.ts:88". */
	where?: string;
}

export interface DiagramBlock {
	type: "diagram";
	/** Mermaid source. Flowcharts, sequence, state, ER, and the rest. */
	text: string;
	/** Optional caption above the diagram. */
	label?: string;
}

export interface TableBlock {
	type: "table";
	/** Optional caption above the table. */
	label?: string;
	columns: string[];
	rows: string[][];
}

export interface CardItem {
	title: string;
	/** Coloured chip, same vocabulary as DecideBlock.severity. */
	badge?: string;
	/** One muted line under the title, e.g. "@alice · 2 blockers". */
	meta?: string;
	/** Makes the whole card clickable. */
	href?: string;
}

/** A grid of small tiles. The at-a-glance strip at the top of a dashboard. */
export interface CardsBlock {
	type: "cards";
	items: CardItem[];
}

/**
 * A collapsible section wrapping other blocks.
 *
 * Nesting is one level deep on purpose: a page of twenty groups inside groups
 * is worse to read than a flat one, and flat rendering keeps ref resolution and
 * decide-id collection simple.
 */
export interface GroupBlock {
	type: "group";
	label: string;
	/** Coloured chip in the header, e.g. "hold", "approve". */
	badge?: string;
	/** Muted line in the header, e.g. "repo · @author · TICKET-1". */
	meta?: string;
	/** Rendered as a link out of the header, e.g. the PR URL. */
	href?: string;
	/** Start expanded. Defaults to true. */
	open?: boolean;
	blocks: Block[];
}

export type Block = MdBlock | RefBlock | DecideBlock | DiagramBlock | TableBlock | CardsBlock | GroupBlock;

export interface Page {
	title: string;
	subtitle?: string;
	blocks: Block[];
}

/** Thrown for malformed input. The message names the offending path. */
export class ValidationError extends Error {}

function fail(path: string, expected: string): never {
	throw new ValidationError(`${path}: ${expected}`);
}

// `unknown` is TypeScript's safe version of `any`: you must narrow it with
// checks before you can use it. That is exactly what a validator does.
function requireString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		fail(path, "expected a non-empty string");
	}
	return value;
}

function validateCardItem(raw: unknown, path: string): CardItem {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		fail(path, "expected an object");
	}
	const item = raw as Record<string, unknown>;
	return {
		title: requireString(item.title, `${path}.title`),
		badge: item.badge === undefined ? undefined : requireString(item.badge, `${path}.badge`),
		meta: item.meta === undefined ? undefined : requireString(item.meta, `${path}.meta`),
		href: item.href === undefined ? undefined : requireString(item.href, `${path}.href`),
	};
}

function validateBlock(raw: unknown, path: string, depth = 0): Block {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		fail(path, "expected an object");
	}
	const block = raw as Record<string, unknown>;
	const type = block.type;

	if (type === "md") {
		return { type: "md", text: requireString(block.text, `${path}.text`) };
	}

	if (type === "ref") {
		if (block.cmd === undefined && block.file === undefined) {
			fail(path, 'a ref block needs either "cmd" or "file"');
		}
		if (block.cmd !== undefined && block.file !== undefined) {
			fail(path, 'a ref block takes "cmd" or "file", not both');
		}
		return {
			type: "ref",
			cmd: block.cmd === undefined ? undefined : requireString(block.cmd, `${path}.cmd`),
			file: block.file === undefined ? undefined : requireString(block.file, `${path}.file`),
			label: block.label === undefined ? undefined : requireString(block.label, `${path}.label`),
		};
	}

	if (type === "diagram") {
		return {
			type: "diagram",
			text: requireString(block.text, `${path}.text`),
			label: block.label === undefined ? undefined : requireString(block.label, `${path}.label`),
		};
	}

	if (type === "table") {
		const columns = block.columns;
		if (!Array.isArray(columns) || columns.length === 0) {
			fail(`${path}.columns`, "expected a non-empty array of strings");
		}
		const parsedColumns = columns.map((column, i) => requireString(column, `${path}.columns[${i}]`));
		const rows = block.rows;
		if (!Array.isArray(rows) || rows.length === 0) {
			fail(`${path}.rows`, "expected a non-empty array of rows");
		}
		const parsedRows = rows.map((rawRow, rowIndex) => {
			if (!Array.isArray(rawRow) || rawRow.length !== parsedColumns.length) {
				fail(`${path}.rows[${rowIndex}]`, `expected ${parsedColumns.length} string cells`);
			}
			return rawRow.map((cell, cellIndex) => {
				if (typeof cell !== "string") {
					fail(`${path}.rows[${rowIndex}][${cellIndex}]`, "expected a string");
				}
				return cell;
			});
		});
		return {
			type: "table",
			label: block.label === undefined ? undefined : requireString(block.label, `${path}.label`),
			columns: parsedColumns,
			rows: parsedRows,
		};
	}

	if (type === "cards") {
		const items = block.items;
		if (!Array.isArray(items) || items.length === 0) {
			fail(`${path}.items`, "expected a non-empty array of card objects");
		}
		return {
			type: "cards",
			items: items.map((item, i) => validateCardItem(item, `${path}.items[${i}]`)),
		};
	}

	if (type === "group") {
		if (depth > 0) {
			fail(path, "groups cannot be nested inside other groups");
		}
		const nested = block.blocks;
		if (!Array.isArray(nested) || nested.length === 0) {
			fail(`${path}.blocks`, "expected a non-empty array");
		}
		const open = block.open;
		if (open !== undefined && typeof open !== "boolean") {
			fail(`${path}.open`, "expected a boolean");
		}
		return {
			type: "group",
			label: requireString(block.label, `${path}.label`),
			badge: block.badge === undefined ? undefined : requireString(block.badge, `${path}.badge`),
			meta: block.meta === undefined ? undefined : requireString(block.meta, `${path}.meta`),
			href: block.href === undefined ? undefined : requireString(block.href, `${path}.href`),
			open,
			blocks: nested.map((child, i) => validateBlock(child, `${path}.blocks[${i}]`, depth + 1)),
		};
	}

	if (type === "decide") {
		const options = block.options;
		if (!Array.isArray(options) || options.length === 0) {
			fail(`${path}.options`, "expected a non-empty array of strings");
		}
		const parsed = options.map((option, i) => requireString(option, `${path}.options[${i}]`));

		const recommend = block.recommend;
		if (recommend !== undefined) {
			requireString(recommend, `${path}.recommend`);
			if (!parsed.includes(recommend as string)) {
				fail(`${path}.recommend`, `must be one of ${JSON.stringify(parsed)}`);
			}
		}

		return {
			type: "decide",
			id: requireString(block.id, `${path}.id`),
			title: requireString(block.title, `${path}.title`),
			body: block.body === undefined ? undefined : requireString(block.body, `${path}.body`),
			options: parsed,
			recommend: recommend as string | undefined,
			severity: block.severity === undefined ? undefined : requireString(block.severity, `${path}.severity`),
			where: block.where === undefined ? undefined : requireString(block.where, `${path}.where`),
		};
	}

	fail(
		`${path}.type`,
		`expected "md", "ref", "diagram", "table", "decide", "cards", or "group", got ${JSON.stringify(type)}`,
	);
}

export function validatePage(raw: unknown): Page {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		fail("<root>", "expected an object");
	}
	const page = raw as Record<string, unknown>;

	if (!Array.isArray(page.blocks) || page.blocks.length === 0) {
		fail("blocks", "expected a non-empty array");
	}

	const blocks = page.blocks.map((block, i) => validateBlock(block, `blocks[${i}]`));

	const ids = flatten(blocks)
		.filter((b): b is DecideBlock => b.type === "decide")
		.map((b) => b.id);
	const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
	if (duplicate) {
		fail("blocks", `duplicate decide id ${JSON.stringify(duplicate)}`);
	}

	return {
		title: requireString(page.title, "title"),
		subtitle: page.subtitle === undefined ? undefined : requireString(page.subtitle, "subtitle"),
		blocks,
	};
}

/**
 * Every block in document order, with group children spliced in where the group
 * sits. Anything that asks "does this page contain an X" walks this, so a block
 * inside a group is never missed.
 */
export function flatten(blocks: Block[]): Block[] {
	return blocks.flatMap((block) => (block.type === "group" ? [block, ...flatten(block.blocks)] : [block]));
}

/** True when the page has anything to wait for. Drives blocking vs detached. */
export function hasDecisions(page: Page): boolean {
	return flatten(page.blocks).some((block) => block.type === "decide");
}

/** Diagrams pull in a script, so pages without one stay fully offline. */
export function hasDiagrams(page: Page): boolean {
	return flatten(page.blocks).some((block) => block.type === "diagram");
}
