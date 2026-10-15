#!/usr/bin/env node
/**
 * viz — render a JSON page description in the browser.
 *
 *   echo '<page json>' | viz
 *
 * Pages with no `decide` block are detached: render, open, print the path, exit.
 * Pages with decisions block until you submit, then print the answers to stdout.
 * `--detach` and `--wait` force either mode.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openInBrowser, shouldOpen } from "./open.ts";
import { echoPage } from "./echo.ts";
import { loadAllowedPrograms, loadEffectiveRemoteConfig, loadEffectiveThemeChoice } from "./config.ts";
import { runConfigCommand } from "./config-command.ts";
import { renderPage, type Mode } from "./render.ts";
import { resolveRefs } from "./resolve.ts";
import { generatePageId, uploadPage, waitForAnswers } from "./remote.ts";
import { hasDecisions, validatePage, ValidationError } from "./schema.ts";
import { resolveTheme, THEMES } from "./themes.ts";
import { TEST_PAGE } from "./test-page.ts";
import { serveOnce } from "./serve.ts";

/** How long a blocking page waits before giving up. Change freely. */
const DEFAULT_TIMEOUT_MINUTES = 30;

const USAGE = `viz — render a JSON page description in the browser

  echo '<page json>' | viz [options]
  viz test [options]
  viz config <remote|show|disable|theme|allow>
  viz themes

Options
  --open              launch the browser (default: just print the link)
  --local             bypass configured remote mode for this invocation
  --theme <choice>    use a named theme or random[_light|_dark|_system]
  --detach            render and exit, never wait for answers
  --wait              wait for answers even if the page has none
  --timeout <min>     how long to wait (default ${DEFAULT_TIMEOUT_MINUTES})
  --echo              also print a plain-text version of the page
  --print             write the HTML to stdout instead of writing a file
  -h, --help          this

Input
  {"title": "...", "subtitle": "...", "blocks": [ ... ]}

Blocks
  {"type": "md",   "text": "markdown"}
  {"type": "ref",  "cmd": "gh pr diff 412"}            (or "file": "src/x.ts")
  {"type": "diagram", "text": "<mermaid source>", "label": "Retry flow"}
  {"type": "table", "label": "Checks", "columns": ["Name", "Result"],
   "rows": [["API", "passing"]]}
  {"type": "decide", "id": "c1", "title": "...", "body": "...",
   "options": ["a", "b"], "recommend": "a",
   "severity": "blocker", "where": "src/x.ts:88"}
  {"type": "cards", "items": [
   {"title": "#412", "badge": "hold", "meta": "@alice \u00b7 2 blockers", "href": "https://..."}]}
  {"type": "group", "label": "PR #412", "badge": "hold", "meta": "repo \u00b7 @alice",
   "href": "https://...", "open": false, "blocks": [ ... ]}

Examples
  viz test --open
  viz --theme random --open < examples/theme-showcase.json
  viz themes
  echo '{"title":"Hello","blocks":[{"type":"md","text":"# Hello"}]}' | viz --open
`;

interface Args {
	force: Mode | null;
	timeoutMinutes: number;
	print: boolean;
	echo: boolean;
	open: boolean;
	local: boolean;
	theme: string | null;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		force: null,
		timeoutMinutes: DEFAULT_TIMEOUT_MINUTES,
		print: false,
		echo: false,
		open: false,
		local: false,
		theme: null,
	};

	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === "-h" || flag === "--help") {
			process.stdout.write(USAGE);
			process.exit(0);
		} else if (flag === "--detach") {
			args.force = "detached";
		} else if (flag === "--wait") {
			args.force = "blocking";
		} else if (flag === "--print") {
			args.print = true;
		} else if (flag === "--echo") {
			args.echo = true;
		} else if (flag === "--open") {
			args.open = true;
		} else if (flag === "--local") {
			args.local = true;
		} else if (flag === "--theme") {
			args.theme = argv[++i] ?? fatal("--theme expects a named or random theme choice");
		} else if (flag === "--timeout") {
			const value = Number(argv[++i]);
			if (!Number.isFinite(value) || value <= 0) {
				fatal("--timeout expects a positive number of minutes");
			}
			args.timeoutMinutes = value;
		} else {
			fatal(`unknown option ${flag}\n\n${USAGE}`);
		}
	}

	return args;
}

function fatal(message: string): never {
	process.stderr.write(`viz: ${message}\n`);
	process.exit(1);
}

async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) {
		fatal(`no input on stdin\n\n${USAGE}`);
	}
	const chunks: Buffer[] = [];
	// `for await` walks an async iterable. A Node stream is one, so this reads
	// the whole of stdin without any callback plumbing.
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

/** Pages go in the project's scratch/ when there is one, otherwise under ~/.viz. */
function pageDirectory(title: string): string {
	const now = new Date();
	const stamp = now.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
	const slug =
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40) || "page";

	const base = existsSync(path.join(process.cwd(), "scratch"))
		? path.join(process.cwd(), "scratch", "viz")
		: path.join(homedir(), ".viz", "pages");

	return path.join(base, `${stamp}-${slug}`);
}

function formatAnswers(answers: Record<string, string>): string {
	const entries = Object.entries(answers);
	if (entries.length === 0) return "no answers submitted";
	return entries.map(([id, value]) => `${id}: ${value}`).join("\n");
}

async function saveLocalCopy(title: string, html: string): Promise<string> {
	const directory = pageDirectory(title);
	await mkdir(directory, { recursive: true });
	const file = path.join(directory, "page.html");
	await writeFile(file, html, "utf8");
	return pathToFileURL(file).href;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (argv[0] === "config") {
		await runConfigCommand(argv.slice(1));
		return;
	}
	if (argv[0] === "themes" && argv.length === 1) {
		for (const theme of THEMES) {
			process.stdout.write(`${theme.name}\t${theme.colorMode}\t${theme.description}\n`);
		}
		return;
	}

	const testCommand = argv[0] === "test";
	const args = parseArgs(testCommand ? argv.slice(1) : argv);
	let parsed: unknown = TEST_PAGE;
	if (!testCommand) {
		const raw = await readStdin();
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			fatal(`input is not valid JSON — ${(error as Error).message}`);
		}
	}

	let page;
	try {
		page = validatePage(parsed);
	} catch (error) {
		if (error instanceof ValidationError) fatal(error.message);
		throw error;
	}

	const inferredMode: Mode = testCommand
		? "detached"
		: hasDecisions(page) ? "blocking" : "detached";
	const mode = args.force ?? inferredMode;
	const theme = resolveTheme(args.theme ?? await loadEffectiveThemeChoice());
	// Resolve decorative artwork once so local, remote, and archive copies match.
	const artVariant = theme.artVariants ? Math.floor(Math.random() * theme.artVariants) : 0;

	// Resolving refs runs commands, so do it once and reuse the output for both
	// the live page and the archive copy.
	const refs = await resolveRefs(page.blocks, process.cwd(), await loadAllowedPrograms());

	if (args.print) {
		process.stdout.write(await renderPage(page, { mode: "detached", refs, theme, artVariant }));
		return;
	}

	const remote = args.local ? null : await loadEffectiveRemoteConfig();

	if (args.echo) process.stdout.write(`${echoPage(page)}\n`);

	if (remote) {
		const id = generatePageId();
		const submitUrl = mode === "blocking" ? `/api/pages/${id}/answers` : undefined;
		const html = await renderPage(page, { mode, submitUrl, refs, theme, artVariant });
		// A blocking server page submits remotely. Its local copy is detached so
		// reopening the flat file still provides working Copy answers controls.
		const localHtml = mode === "detached"
			? html
			: await renderPage(page, { mode: "detached", refs, theme, artVariant });
		const fileUrl = await saveLocalCopy(page.title, localHtml);
		if (mode === "detached") process.stdout.write(`file: ${fileUrl}\n`);
		else process.stderr.write(`viz: local copy — ${fileUrl}\n`);

		let url: string;
		try {
			url = await uploadPage(remote, id, html);
		} catch (error) {
			throw new Error(`${(error as Error).message}; use --local to bypass remote mode`);
		}
		if (shouldOpen(args.open)) openInBrowser(url);
		if (mode === "detached") {
			process.stdout.write(`page: ${url}\n`);
			return;
		}

		process.stderr.write(`viz: waiting for answers — ${url}\n`);
		const answers = await waitForAnswers(remote, id, args.timeoutMinutes * 60_000);
		if (answers === null) {
			process.stdout.write(`abandoned: nobody answered within ${args.timeoutMinutes} minutes\n`);
			return;
		}
		process.stdout.write(`${formatAnswers(answers)}\n`);
		return;
	}

	if (mode === "detached") {
		const html = await renderPage(page, { mode: "detached", refs, theme, artVariant });
		const fileUrl = await saveLocalCopy(page.title, html);
		if (shouldOpen(args.open)) openInBrowser(fileURLToPath(fileUrl));
		// A file:// URL rather than a bare path, because terminals turn it into
		// something clickable.
		process.stdout.write(`page: ${fileUrl}\n`);
		return;
	}

	const directory = pageDirectory(page.title);
	await mkdir(directory, { recursive: true });
	const file = path.join(directory, "page.html");

	// Blocking: serve from localhost so the page can POST back same-origin.
	const timeoutMs = args.timeoutMinutes * 60_000;
	const session = await serveOnce(
		(token) => renderPage(page, {
			mode: "blocking",
			submitUrl: `/submit?t=${token}`,
			refs,
			theme,
			artVariant,
		}),
		timeoutMs,
	);

	// Keep an archive copy on disk. It is rendered detached, so reopening it
	// later still works: the copy button functions, the dead POST URL does not.
	await writeFile(
		file,
		await renderPage(page, { mode: "detached", refs, theme, artVariant }),
		"utf8",
	);
	const fileUrl = pathToFileURL(file).href;

	if (shouldOpen(args.open)) openInBrowser(session.url);
	process.stderr.write(`viz: local copy — ${fileUrl}\n`);
	process.stderr.write(`viz: waiting for answers — ${session.url}\n`);

	const result = await session.wait();

	if (result.reason === "timeout") {
		process.stdout.write(`abandoned: nobody answered within ${args.timeoutMinutes} minutes\n`);
		return;
	}

	process.stdout.write(`${formatAnswers(result.answers ?? {})}\n`);
}

main().catch((error) => fatal((error as Error).message));
