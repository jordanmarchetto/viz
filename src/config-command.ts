import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import {
	configPath,
	disableRemoteConfig,
	disableThemeConfig,
	loadEffectiveRemoteConfig,
	loadEffectiveThemeChoice,
	redactedConfig,
	saveRemoteConfig,
	saveThemeConfig,
} from "./config.ts";

export async function runConfigCommand(args: string[]): Promise<void> {
	const command = args[0];
	if (command === "theme") {
		const choice = args[1];
		if (args.length !== 2 || !choice) {
			throw new Error("usage: viz config theme <name|random[_light|_dark|_system]|disable>");
		}
		if (choice === "disable") {
			const changed = await disableThemeConfig();
			process.stdout.write(changed ? `theme config removed from ${configPath()}\n` : "theme config is not set\n");
			return;
		}
		await saveThemeConfig(choice);
		process.stdout.write(`default theme saved to ${configPath()}\n`);
		return;
	}

	if (args.length !== 1 || !["remote", "show", "disable"].includes(command ?? "")) {
		throw new Error("usage: viz config <remote|show|disable|theme>");
	}

	if (command === "show") {
		const [remote, theme] = await Promise.all([loadEffectiveRemoteConfig(), loadEffectiveThemeChoice()]);
		process.stdout.write(`${JSON.stringify(redactedConfig(remote, theme), null, 2)}\n`);
		return;
	}

	if (command === "disable") {
		const changed = await disableRemoteConfig();
		process.stdout.write(changed ? `remote config removed from ${configPath()}\n` : "remote config is not set\n");
		return;
	}

	const { serverUrl, token } = process.stdin.isTTY
		? await promptInteractively()
		: await readPipedConfiguration();
	await saveRemoteConfig({ serverUrl, token });
	process.stdout.write(`remote config saved to ${configPath()}\n`);
}

async function promptInteractively(): Promise<{ serverUrl: string; token: string }> {
	let muted = false;
	// readline performs terminal echo through its output stream. Muting this
	// proxy hides the token while keeping one interface, so pasted input is not
	// lost between two separate readline instances.
	const output = new Writable({
		write(chunk: Buffer, _encoding, callback) {
			if (!muted) process.stdout.write(chunk);
			callback();
		},
	});
	const readline = createInterface({ input: process.stdin, output, terminal: true });
	try {
		const serverUrl = await readline.question("Server URL: ");
		process.stdout.write("Shared token: ");
		muted = true;
		const token = await readline.question("");
		muted = false;
		process.stdout.write("\n");
		return { serverUrl, token };
	} finally {
		muted = false;
		readline.close();
	}
}

async function readPipedConfiguration(): Promise<{ serverUrl: string; token: string }> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	const [serverUrl, token] = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
	if (!serverUrl || !token) {
		throw new Error("piped config expects the server URL on line 1 and token on line 2");
	}
	return { serverUrl, token };
}
