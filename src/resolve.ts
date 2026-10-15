/**
 * Resolves `ref` blocks: turns "show me this diff" into actual text.
 *
 * This is the part that saves tokens. The model writes a dozen characters
 * naming a command, and viz produces the hundreds of lines you actually read.
 * None of that output ever enters the model's context.
 *
 * Commands run through an allowlist with no shell. The model already has a
 * bash tool, so this is not a security boundary against a hostile model; it is
 * a guard against a careless one, and it keeps a misfired `ref` from being a
 * destructive event.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { flatten, type Block, type RefBlock } from "./schema.ts";

const run = promisify(execFile);

/** Binaries a ref block may invoke. Add more with VIZ_ALLOW="foo,bar". */
const DEFAULT_ALLOWED = [
	"gh-axi",
	"gh",
	"git",
	"jira-axi",
	"confluence-axi",
	"slack-axi",
	"cat",
	"head",
	"tail",
	"ls",
	"rg",
	"grep",
	"find",
	"wc",
	"diff",
];

/** Characters that only mean something to a shell. Their presence is a mistake. */
const SHELL_CHARS = /[|&;<>$`\\(){}[\]*?!~\n]/;

const MAX_BYTES = 200_000;
const MAX_LINES = 2_000;
const TIMEOUT_MS = 30_000;

function allowed(): string[] {
	const extra = (process.env.VIZ_ALLOW ?? "")
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
	return [...DEFAULT_ALLOWED, ...extra];
}

/**
 * Split a command into argv the way a shell would for simple cases, honouring
 * single and double quotes. Anything needing real shell behaviour is rejected
 * before this runs.
 */
function splitArgs(command: string): string[] {
	const parts: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;

	for (const char of command) {
		if (quote) {
			if (char === quote) quote = null;
			else current += char;
		} else if (char === '"' || char === "'") {
			quote = char;
		} else if (char === " " || char === "\t") {
			if (current) parts.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	if (current) parts.push(current);
	return parts;
}

/**
 * Undo escaping when a tool returns multi-line content as a single quoted
 * string. `gh-axi pr diff` does this: the whole diff arrives as one line with
 * literal backslash-n in it, which is compact for a model and unreadable on a
 * page.
 *
 * Only fires when the text is overwhelmingly escaped newlines rather than real
 * ones, so ordinary output containing a stray \n in a string is left alone.
 */
function unescapeIfPacked(text: string): string {
	const real = (text.match(/\n/g) ?? []).length;
	const escaped = (text.match(/\\n/g) ?? []).length;
	if (escaped < 5 || escaped < real * 3) return text;

	return text
		.replace(/\\r\\n/g, "\n")
		.replace(/\\n/g, "\n")
		.replace(/\\t/g, "\t")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\");
}

function clamp(text: string): string {
	let output = unescapeIfPacked(text);
	let note = "";

	const lines = output.split("\n");
	if (lines.length > MAX_LINES) {
		output = lines.slice(0, MAX_LINES).join("\n");
		note = `\n\n… truncated at ${MAX_LINES} lines`;
	}
	if (Buffer.byteLength(output, "utf8") > MAX_BYTES) {
		output = output.slice(0, MAX_BYTES);
		note = `\n\n… truncated at ${MAX_BYTES} bytes`;
	}
	return output + note;
}

async function resolveCmd(command: string, cwd: string): Promise<string> {
	// Strip quoted spans before scanning, so a legitimate "a|b" argument does
	// not look like a pipe.
	const unquoted = command.replace(/"[^"]*"|'[^']*'/g, "");
	if (SHELL_CHARS.test(unquoted)) {
		return `viz: refusing to run a command containing shell syntax\n\n  ${command}\n\nref blocks run a single program with no shell. Pipes, redirects, and && are not available.`;
	}

	const argv = splitArgs(command);
	const binary = argv[0];
	if (!binary) return "viz: empty command";

	if (!allowed().includes(binary)) {
		return `viz: ${binary} is not on the ref allowlist\n\nAllowed: ${allowed().join(", ")}\n\nAdd more with VIZ_ALLOW="${binary}".`;
	}

	try {
		const { stdout, stderr } = await run(binary, argv.slice(1), {
			cwd,
			timeout: TIMEOUT_MS,
			maxBuffer: MAX_BYTES * 2,
			// Stop pagers and colour codes, which would render as escape noise.
			env: { ...process.env, GIT_PAGER: "cat", PAGER: "cat", NO_COLOR: "1" },
		});
		const text = stdout.trim() || stderr.trim();
		return clamp(text || "(no output)");
	} catch (error) {
		const err = error as { stdout?: string; stderr?: string; message: string };
		// A non-zero exit is often still useful output, e.g. `git diff --exit-code`.
		const text = (err.stdout || "").trim() || (err.stderr || "").trim();
		return clamp(text || `viz: ${err.message}`);
	}
}

async function resolveFile(file: string, cwd: string): Promise<string> {
	try {
		return clamp(await readFile(path.resolve(cwd, file), "utf8"));
	} catch (error) {
		return `viz: could not read ${file} — ${(error as Error).message}`;
	}
}

async function resolveOne(block: RefBlock, cwd: string): Promise<string> {
	if (block.cmd) return resolveCmd(block.cmd, cwd);
	if (block.file) return resolveFile(block.file, cwd);
	return "viz: ref block has neither cmd nor file";
}

/**
 * Resolve every ref block in the page, in parallel, keyed by the block object
 * itself rather than its position. Groups mean a block's index is no longer
 * unique, and identity keys cannot drift out of step with the render order.
 *
 * Failures become visible text in the page rather than killing the run: a
 * broken ref should not cost you the whole page.
 */
export async function resolveRefs(blocks: Block[], cwd: string): Promise<Map<RefBlock, string>> {
	const jobs = flatten(blocks).filter((block): block is RefBlock => block.type === "ref");

	const results = await Promise.all(jobs.map((job) => resolveOne(job, cwd)));

	return new Map(jobs.map((job, i) => [job, results[i]]));
}
