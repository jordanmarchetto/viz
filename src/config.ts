import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { validateThemeChoice, type ThemeChoice } from "./themes.ts";

export interface RemoteConfig {
	serverUrl: string;
	token: string;
}

type ConfigFile = Record<string, unknown> & { remote?: RemoteConfig; theme?: string };

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
	const home = env.HOME?.trim() || homedir();
	const root = env.XDG_CONFIG_HOME?.trim() || path.join(home, ".config");
	return path.join(root, "viz", "config.json");
}

export async function loadEffectiveRemoteConfig(
	env: NodeJS.ProcessEnv = process.env,
): Promise<RemoteConfig | null> {
	const environmentConfigured = env.VIZ_SERVER_URL !== undefined || env.VIZ_TOKEN !== undefined;
	if (environmentConfigured) {
		if (!env.VIZ_SERVER_URL || !env.VIZ_TOKEN) {
			throw new Error("set both VIZ_SERVER_URL and VIZ_TOKEN, or unset both");
		}
		return validateRemote({ serverUrl: env.VIZ_SERVER_URL, token: env.VIZ_TOKEN });
	}

	const config = await readConfig(env);
	if (config.remote === undefined) return null;
	return validateRemote(config.remote);
}

export async function loadEffectiveThemeChoice(
	env: NodeJS.ProcessEnv = process.env,
): Promise<ThemeChoice> {
	if (env.VIZ_THEME !== undefined) return validateThemeChoice(env.VIZ_THEME);
	const config = await readConfig(env);
	if (config.theme === undefined) return "classic";
	if (typeof config.theme !== "string") throw new Error("theme must be a string");
	return validateThemeChoice(config.theme);
}

export async function saveThemeConfig(
	theme: string,
	env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	const config = await readConfig(env);
	config.theme = validateThemeChoice(theme);
	await writeConfig(config, env);
}

export async function disableThemeConfig(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
	const config = await readConfig(env);
	if (config.theme === undefined) return false;
	delete config.theme;
	await writeConfig(config, env);
	return true;
}

export async function saveRemoteConfig(
	remote: RemoteConfig,
	env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	const config = await readConfig(env);
	config.remote = validateRemote(remote);
	await writeConfig(config, env);
}

export async function disableRemoteConfig(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
	const config = await readConfig(env);
	if (config.remote === undefined) return false;
	delete config.remote;
	await writeConfig(config, env);
	return true;
}

export function redactedConfig(remote: RemoteConfig | null, theme: ThemeChoice): object {
	return {
		remote: remote ? { serverUrl: remote.serverUrl, token: "[redacted]" } : null,
		theme,
	};
}

function validateRemote(value: unknown): RemoteConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("remote config must be an object");
	}
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.serverUrl !== "string" || !candidate.serverUrl.trim()) {
		throw new Error("remote.serverUrl is required");
	}
	if (typeof candidate.token !== "string" || candidate.token.length < 16) {
		throw new Error("remote.token must contain at least 16 characters");
	}

	const serverUrl = candidate.serverUrl.trim().replace(/\/+$/, "");
	let parsed: URL;
	try {
		parsed = new URL(serverUrl);
	} catch {
		throw new Error("remote.serverUrl must be an absolute HTTP or HTTPS URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("remote.serverUrl must be an absolute HTTP or HTTPS URL");
	}
	return { serverUrl, token: candidate.token };
}

async function readConfig(env: NodeJS.ProcessEnv): Promise<ConfigFile> {
	const file = configPath(env);
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch (error) {
		if (isCode(error, "ENOENT")) return {};
		throw error;
	}

	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`${file} is not valid JSON`);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${file} must contain a JSON object`);
	}
	return value as ConfigFile;
}

async function writeConfig(config: ConfigFile, env: NodeJS.ProcessEnv): Promise<void> {
	const file = configPath(env);
	const directory = path.dirname(file);
	const temporary = path.join(directory, `.config-${randomUUID()}.tmp`);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	try {
		await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
			flag: "wx",
		});
		await rename(temporary, file);
	} catch (error) {
		const { rm } = await import("node:fs/promises");
		await rm(temporary, { force: true });
		throw error;
	}
}

function isCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
