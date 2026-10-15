/**
 * The one-shot localhost server used in blocking mode.
 *
 * It serves exactly one page, accepts exactly one POST of answers, and shuts
 * down. Nothing is left running after viz exits.
 *
 * Why a server at all, rather than opening the file directly: a file:// page
 * cannot POST to localhost without tripping cross-origin rules. Serving the
 * page from the same origin it posts to avoids that entirely.
 */

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface WaitResult {
	/** Answers keyed by decide-block id, or null when nobody submitted. */
	answers: Record<string, string> | null;
	reason: "submitted" | "timeout";
}

export interface Session {
	url: string;
	/** Resolves when answers arrive or the timeout elapses. Always closes the server. */
	wait(): Promise<WaitResult>;
}

export async function serveOnce(
	render: (token: string) => string | Promise<string>,
	timeoutMs: number,
): Promise<Session> {
	// A random token in the URL means another process on the machine cannot
	// guess the address and read the page.
	const token = randomBytes(16).toString("hex");
	const html = await render(token);

	let settle: ((result: WaitResult) => void) | null = null;

	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");

		if (url.searchParams.get("t") !== token) {
			res.writeHead(403).end("forbidden");
			return;
		}

		if (req.method === "GET") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
			return;
		}

		if (req.method === "POST" && url.pathname === "/submit") {
			const chunks: Buffer[] = [];
			req.on("data", (chunk) => chunks.push(chunk));
			req.on("end", () => {
				res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
				try {
					const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
					settle?.({ answers: body.answers ?? {}, reason: "submitted" });
				} catch {
					settle?.({ answers: {}, reason: "submitted" });
				}
			});
			return;
		}

		res.writeHead(404).end("not found");
	});

	// Port 0 asks the operating system for any free port, so viz never collides
	// with something already listening.
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	const url = `http://127.0.0.1:${port}/?t=${token}`;

	return {
		url,
		wait() {
			return new Promise<WaitResult>((resolve) => {
				let finished = false;

				const finish = (result: WaitResult) => {
					if (finished) return;
					finished = true;
					clearTimeout(timer);
					// Give the browser a moment to receive the response before the
					// socket goes away, otherwise the page shows a network error.
					setTimeout(() => {
						server.close();
						server.closeAllConnections();
						resolve(result);
					}, 300);
				};

				const timer = setTimeout(() => finish({ answers: null, reason: "timeout" }), timeoutMs);
				settle = finish;
			});
		},
	};
}
