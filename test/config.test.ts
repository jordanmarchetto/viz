import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  configPath,
  disableAllowedPrograms,
  disableRemoteConfig,
  disableThemeConfig,
  loadAllowedPrograms,
  loadEffectiveRemoteConfig,
  loadEffectiveThemeChoice,
  saveAllowedPrograms,
  saveRemoteConfig,
  saveThemeConfig,
} from "../src/config.ts";

const directories: string[] = [];

async function environment(): Promise<NodeJS.ProcessEnv> {
  const directory = await mkdtemp(path.join(tmpdir(), "viz-config-test-"));
  directories.push(directory);
  return { HOME: directory, XDG_CONFIG_HOME: path.join(directory, "config") };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("theme configuration", () => {
  test("defaults to classic and supports saved, direct, and environment choices", async () => {
    const env = await environment();
    assert.equal(await loadEffectiveThemeChoice(env), "classic");

    await saveThemeConfig("random_light", env);
    assert.equal(await loadEffectiveThemeChoice(env), "random_light");
    assert.equal(await loadEffectiveThemeChoice({ ...env, VIZ_THEME: "random_dark" }), "random_dark");

    await writeFile(configPath(env), '{"theme":"random_system"}\n');
    assert.equal(await loadEffectiveThemeChoice(env), "random_system");
  });

  test("rejects unknown choices and removes only the saved theme", async () => {
    const env = await environment();
    await assert.rejects(
      saveThemeConfig("sparkles", env),
      /random_light, random_dark, random_system/,
    );
    await saveRemoteConfig({ serverUrl: "http://server.test", token: "0123456789abcdef" }, env);
    await saveThemeConfig("storybook", env);

    assert.equal(await disableThemeConfig(env), true);
    const config = JSON.parse(await readFile(configPath(env), "utf8")) as Record<string, unknown>;
    assert.equal(config.theme, undefined);
    assert.notEqual(config.remote, undefined);
    assert.equal(await disableThemeConfig(env), false);
  });
});

describe("ref command configuration", () => {
  test("saves program names and combines them with the environment override", async () => {
    const env = await environment();
    assert.deepEqual(await loadAllowedPrograms(env), []);

    await saveAllowedPrograms(["gh-axi", "jira-axi", "gh-axi"], env);
    await saveAllowedPrograms(["confluence-axi"], env);
    assert.deepEqual(await loadAllowedPrograms(env), ["gh-axi", "jira-axi", "confluence-axi"]);
    assert.deepEqual(
      await loadAllowedPrograms({ ...env, VIZ_ALLOW: "slack-axi,gh-axi" }),
      ["gh-axi", "jira-axi", "confluence-axi", "slack-axi"],
    );

    assert.equal(await disableAllowedPrograms(env), true);
    assert.deepEqual(await loadAllowedPrograms(env), []);
    assert.equal(await disableAllowedPrograms(env), false);
  });

  test("rejects malformed program names and ref configuration", async () => {
    const env = await environment();
    await assert.rejects(saveAllowedPrograms(["../tool"], env), /invalid allowed program/);
    await assert.rejects(
      loadAllowedPrograms({ ...env, VIZ_ALLOW: "tool;rm" }),
      /invalid allowed program/,
    );
    await saveAllowedPrograms(["gh-axi"], env);
    await writeFile(configPath(env), '{"ref":{"allowedPrograms":"gh-axi"}}\n');
    await assert.rejects(loadAllowedPrograms(env), /array of program names/);
  });
});

describe("remote configuration", () => {
  test("writes a private config and loads it", async () => {
    const env = await environment();
    await saveRemoteConfig({ serverUrl: "http://server.test:5008/", token: "0123456789abcdef" }, env);

    assert.deepEqual(await loadEffectiveRemoteConfig(env), {
      serverUrl: "http://server.test:5008",
      token: "0123456789abcdef",
    });
    assert.equal((await stat(configPath(env))).mode & 0o777, 0o600);
  });

  test("environment variables override file values", async () => {
    const env = await environment();
    await saveRemoteConfig({ serverUrl: "http://file.test", token: "file-token-123456" }, env);

    assert.deepEqual(await loadEffectiveRemoteConfig({
      ...env,
      VIZ_SERVER_URL: "https://environment.test/",
      VIZ_TOKEN: "environment-token",
    }), {
      serverUrl: "https://environment.test",
      token: "environment-token",
    });
  });

  test("returns null when remote mode is not configured", async () => {
    assert.equal(await loadEffectiveRemoteConfig(await environment()), null);
  });

  test("rejects partial, malformed, and insecure configuration", async () => {
    const env = await environment();
    await assert.rejects(
      loadEffectiveRemoteConfig({ ...env, VIZ_SERVER_URL: "http://server.test" }),
      /both VIZ_SERVER_URL and VIZ_TOKEN/,
    );
    await assert.rejects(
      saveRemoteConfig({ serverUrl: "file:///tmp/pages", token: "0123456789abcdef" }, env),
      /HTTP or HTTPS/,
    );
    await assert.rejects(
      saveRemoteConfig({ serverUrl: "http://server.test", token: "short" }, env),
      /at least 16/,
    );

    await saveRemoteConfig({ serverUrl: "http://server.test", token: "0123456789abcdef" }, env);
    await writeFile(configPath(env), "not JSON", { mode: 0o600 });
    await assert.rejects(loadEffectiveRemoteConfig(env), /not valid JSON/);
  });

  test("disable removes only remote configuration", async () => {
    const env = await environment();
    await saveRemoteConfig({ serverUrl: "http://server.test", token: "0123456789abcdef" }, env);
    const file = configPath(env);
    const config = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    config.theme = "dark";
    await writeFile(file, `${JSON.stringify(config)}\n`);
    await chmod(file, 0o600);

    assert.equal(await disableRemoteConfig(env), true);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { theme: "dark" });
    assert.equal(await loadEffectiveRemoteConfig(env), null);
  });
});
