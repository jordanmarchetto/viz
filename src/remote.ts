import { randomUUID } from "node:crypto";
import type { RemoteConfig } from "./config.ts";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type Answers = Record<string, string>;

export function generatePageId(): string {
	return randomUUID();
}

export async function uploadPage(
	config: RemoteConfig,
	id: string,
	html: string,
	fetchPage: Fetch = fetch,
): Promise<string> {
	let response: Response;
	try {
		response = await fetchPage(`${config.serverUrl}/api/pages/${id}`, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${config.token}`,
				"Content-Type": "text/html; charset=utf-8",
			},
			body: html,
			signal: AbortSignal.timeout(15_000),
		});
	} catch (error) {
		throw new Error(`remote upload failed: ${(error as Error).message}`);
	}

	if (!response.ok) {
		let detail = response.statusText;
		try {
			const body = await response.json() as { error?: unknown };
			if (typeof body.error === "string") detail = body.error;
		} catch {
			// Keep the HTTP status text when the server did not return JSON.
		}
		throw new Error(`remote upload failed (${response.status}): ${detail || "unknown error"}`);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new Error("remote server returned invalid JSON");
	}
	if (typeof body !== "object" || body === null || !("url" in body) || typeof body.url !== "string") {
		throw new Error("remote server did not return a page URL");
	}
	try {
		const url = new URL(body.url);
		if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
	} catch {
		throw new Error("remote server returned an invalid page URL");
	}
	return body.url;
}

export async function waitForAnswers(
	config: RemoteConfig,
	id: string,
	timeoutMs: number,
	fetchResult: Fetch = fetch,
	retryDelayMs = 500,
): Promise<Answers | null> {
	const deadline = Date.now() + timeoutMs;
	const endpoint = `${config.serverUrl}/api/pages/${id}/result`;

	while (Date.now() < deadline) {
		const remaining = deadline - Date.now();
		let response: Response;
		try {
			response = await fetchResult(endpoint, {
				headers: { Authorization: `Bearer ${config.token}` },
				signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, remaining))),
			});
		} catch {
			if (Date.now() >= deadline) return null;
			await delay(Math.min(retryDelayMs, deadline - Date.now()));
			continue;
		}

		if (response.status === 204) continue;
		if (response.status >= 500) {
			await delay(Math.min(retryDelayMs, Math.max(0, deadline - Date.now())));
			continue;
		}
		if (!response.ok) {
			throw new Error(`result request failed (${response.status}): ${await errorDetail(response)}`);
		}

		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new Error("remote server returned invalid result JSON");
		}
		if (typeof body !== "object" || body === null || !("answers" in body)) {
			throw new Error("remote server returned invalid answers");
		}
		const raw = body.answers;
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
			throw new Error("remote server returned invalid answers");
		}
		const entries = Object.entries(raw);
		if (entries.some(([, value]) => typeof value !== "string")) {
			throw new Error("remote server returned invalid answers");
		}
		return Object.fromEntries(entries) as Answers;
	}
	return null;
}

async function errorDetail(response: Response): Promise<string> {
	try {
		const body = await response.json() as { error?: unknown };
		if (typeof body.error === "string") return body.error;
	} catch {
		// Fall back to the status text for non-JSON responses.
	}
	return response.statusText || "unknown error";
}

function delay(milliseconds: number): Promise<void> {
	if (milliseconds <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
