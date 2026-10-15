/**
 * Open a URL or file in the default browser.
 *
 * Opt-in only. viz prints a link and stops by default, because a page that
 * steals focus is worse than a page you click when you are ready.
 */

import { execFile } from "node:child_process";

export function openInBrowser(target: string): void {
	const command =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";

	// Empty callback swallows failures on purpose. If the browser will not open,
	// viz has already printed the link, so the user still has a way in.
	execFile(command, [target], () => {});
}

/** True when this invocation should launch a browser. */
export function shouldOpen(flag: boolean): boolean {
	return flag || process.env.VIZ_OPEN === "1";
}
