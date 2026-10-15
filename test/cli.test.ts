import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { spawn } from "node:child_process";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = JSON.stringify({ title: "Remote CLI test", blocks: [{ type: "md", text: "# uploaded" }] });
const TOKEN = "0123456789abcdef";
const directories: string[] = [];

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "viz-cli-test-"));
  directories.push(directory);
  return directory;
}

function run(args: string[], input: string, env: NodeJS.ProcessEnv, cwd: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "src/cli.ts"), ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => stdout += chunk);
    child.stderr.setEncoding("utf8").on("data", (chunk) => stderr += chunk);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("config commands save, redact, and disable remote settings", async () => {
  const directory = await temporaryDirectory();
  const env = { HOME: directory, XDG_CONFIG_HOME: path.join(directory, "config") };

  const configured = await run(["config", "remote"], `http://server.test:5008\n${TOKEN}\n`, env, directory);
  assert.equal(configured.code, 0, configured.stderr);
  assert.match(configured.stdout, /remote config saved/);

  const shown = await run(["config", "show"], "", env, directory);
  assert.equal(shown.code, 0, shown.stderr);
  assert.match(shown.stdout, /http:\/\/server\.test:5008/);
  assert.match(shown.stdout, /\[redacted\]/);
  assert.doesNotMatch(shown.stdout, new RegExp(TOKEN));

  const disabled = await run(["config", "disable"], "", env, directory);
  assert.equal(disabled.code, 0, disabled.stderr);
  assert.match(disabled.stdout, /remote config removed/);
  const file = JSON.parse(await readFile(path.join(directory, "config/viz/config.json"), "utf8"));
  assert.deepEqual(file, {});
});

test("configures extra ref programs and shows their effective values", async () => {
  const directory = await temporaryDirectory();
  const env = { HOME: directory, XDG_CONFIG_HOME: path.join(directory, "config") };

  const configured = await run(["config", "allow", "gh-axi", "jira-axi"], "", env, directory);
  assert.equal(configured.code, 0, configured.stderr);
  assert.match(configured.stdout, /ref allowlist saved/);

  const shown = await run(["config", "show"], "", { ...env, VIZ_ALLOW: "slack-axi" }, directory);
  assert.equal(shown.code, 0, shown.stderr);
  assert.match(shown.stdout, /"allowedPrograms": \[/);
  assert.match(shown.stdout, /"gh-axi"/);
  assert.match(shown.stdout, /"jira-axi"/);
  assert.match(shown.stdout, /"slack-axi"/);

  const disabled = await run(["config", "allow", "disable"], "", env, directory);
  assert.equal(disabled.code, 0, disabled.stderr);
  assert.match(disabled.stdout, /ref allowlist removed/);
});

test("uses configured ref programs without making them public defaults", async () => {
  const directory = await temporaryDirectory();
  const env = { HOME: directory, XDG_CONFIG_HOME: path.join(directory, "config") };
  const page = JSON.stringify({
    title: "Configured ref",
    blocks: [{ type: "ref", cmd: "node --version" }],
  });

  const rejected = await run(["--print"], page, env, directory);
  assert.equal(rejected.code, 0, rejected.stderr);
  assert.match(rejected.stdout, /is not on the ref allowlist/);

  const configured = await run(["config", "allow", "node"], "", env, directory);
  assert.equal(configured.code, 0, configured.stderr);
  const rendered = await run(["--print"], page, env, directory);
  assert.equal(rendered.code, 0, rendered.stderr);
  assert.match(rendered.stdout, new RegExp(process.version.replaceAll(".", "\\.")));
});

test("lists themes and applies flag, environment, and configured choices", async () => {
  const directory = await temporaryDirectory();
  const baseEnv = { HOME: directory, XDG_CONFIG_HOME: path.join(directory, "config") };
  const env = { ...baseEnv, VIZ_THEME: "classic" };

  const listed = await run(["themes"], "", env, directory);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, /^classic\tsystem\t/m);
  assert.match(listed.stdout, /^storybook\tsystem\t/m);
  assert.match(listed.stdout, /^unicorn\tsystem\t/m);
  assert.match(listed.stdout, /^arcade\tsystem\t/m);
  assert.match(listed.stdout, /^rainbow\tindependent\t/m);
  assert.match(listed.stdout, /^zine\tindependent\t/m);
  assert.match(listed.stdout, /^high-fantasy\tindependent\t/m);
  assert.match(listed.stdout, /^adventurer-handbook\tindependent\t/m);
  assert.match(listed.stdout, /^inferno\tindependent\t/m);
  assert.match(listed.stdout, /^dark-cathedral\tindependent\t/m);
  assert.match(listed.stdout, /^swamp\tindependent\t/m);
  assert.match(listed.stdout, /^space-command\tindependent\t/m);

  const configured = await run(["config", "theme", "storybook"], "", env, directory);
  assert.equal(configured.code, 0, configured.stderr);
  const shown = await run(["config", "show"], "", baseEnv, directory);
  assert.match(shown.stdout, /"theme": "storybook"/);

  const fromConfig = await run(["--print"], PAGE, baseEnv, directory);
  assert.equal(fromConfig.code, 0, fromConfig.stderr);
  assert.match(fromConfig.stdout, /data-theme="storybook"/);

  const fromEnvironment = await run(["--print"], PAGE, { ...env, VIZ_THEME: "classic" }, directory);
  assert.match(fromEnvironment.stdout, /data-theme="classic"/);
  const fromFlag = await run(["--print", "--theme", "storybook"], PAGE, env, directory);
  assert.match(fromFlag.stdout, /data-theme="storybook"/);

  const randomLight = await run(["--print", "--theme", "random_light"], PAGE, env, directory);
  assert.match(randomLight.stdout, /data-theme-mode="light"/);
  const randomDark = await run(["--print"], PAGE, { ...env, VIZ_THEME: "random_dark" }, directory);
  assert.match(randomDark.stdout, /data-theme-mode="dark"/);
  const randomSystem = await run(["config", "theme", "random_system"], "", baseEnv, directory);
  assert.equal(randomSystem.code, 0, randomSystem.stderr);
  const fromRandomConfig = await run(["--print"], PAGE, baseEnv, directory);
  assert.match(fromRandomConfig.stdout, /data-theme-mode="system"/);

  const invalid = await run(["--print", "--theme", "sparkles"], PAGE, env, directory);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /random_light, random_dark, random_system/);

  const disabled = await run(["config", "theme", "disable"], "", env, directory);
  assert.equal(disabled.code, 0, disabled.stderr);
  assert.match(disabled.stdout, /theme config removed/);
});

test("help includes copyable examples and the representative test page", async () => {
  const directory = await temporaryDirectory();
  const result = await run(["--help"], "", {}, directory);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Examples\n  viz test --open\n/);
  assert.match(result.stdout, /viz --theme random --open < examples\/theme-showcase\.json/);
  assert.match(result.stdout, /echo '\{"title":"Hello".*\}' \| viz --open/);
});

test("test command renders a detached representative page without stdin", async () => {
  const directory = await temporaryDirectory();
  const result = await run(["test", "--local", "--theme", "random_dark"], "", {
    HOME: directory,
    XDG_CONFIG_HOME: path.join(directory, "config"),
  }, directory);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^page: file:\/\//);
  const html = await readFile(fileURLToPath(result.stdout.trim().replace("page: ", "")), "utf8");
  assert.match(html, /<title>viz test page<\/title>/);
  assert.match(html, /data-theme-mode="dark"/);
  assert.match(html, /<pre class="mermaid"/);
  assert.match(html, /Copy answers/);
});

test("detached mode saves local HTML, uploads it, and prints both URLs", async () => {
  const directory = await temporaryDirectory();
  let html = "";
  let id = "";
  const server = createServer(async (request, response) => {
    id = request.url?.split("/").at(-1) ?? "";
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    for await (const chunk of request) html += chunk.toString();
    response.writeHead(201, { "content-type": "application/json" });
    response.end(JSON.stringify({ id, url: `https://viz.example.test/pages/${id}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    const result = await run(["--detach"], PAGE, {
      HOME: directory,
      XDG_CONFIG_HOME: path.join(directory, "config"),
      VIZ_SERVER_URL: `http://127.0.0.1:${address.port}`,
      VIZ_TOKEN: TOKEN,
      VIZ_THEME: "adventurer-handbook",
    }, directory);
    assert.equal(result.code, 0, result.stderr);
    assert.match(id, /^[0-9a-f-]{36}$/);
    const [fileLine, pageLine] = result.stdout.trim().split("\n");
    assert.match(fileLine, /^file: file:\/\//);
    assert.equal(pageLine, `page: https://viz.example.test/pages/${id}`);
    assert.match(html, /<h1>uploaded<\/h1>/);
    assert.match(html, /data-theme="adventurer-handbook"/);
    const remoteVariant = html.match(/data-art-variant="(\d+)"/)?.[1];
    assert(remoteVariant);
    const localHtml = await readFile(fileURLToPath(fileLine.replace("file: ", "")), "utf8");
    assert.match(localHtml, /<h1>uploaded<\/h1>/);
    assert.match(localHtml, /data-theme="adventurer-handbook"/);
    assert.match(localHtml, new RegExp(`data-art-variant="${remoteVariant}"`));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("--local bypasses configured remote mode", async () => {
  const directory = await temporaryDirectory();
  const result = await run(["--detach", "--local"], PAGE, {
    HOME: directory,
    XDG_CONFIG_HOME: path.join(directory, "config"),
    VIZ_SERVER_URL: "http://127.0.0.1:1",
    VIZ_TOKEN: TOKEN,
  }, directory);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^page: file:\/\//);
});

test("remote blocking mode uploads an answer URL and reconnects for results", async () => {
  const directory = await temporaryDirectory();
  const page = JSON.stringify({
    title: "Blocking",
    blocks: [{ type: "decide", id: "q1", title: "Choose", options: ["A", "B"] }],
  });
  let html = "";
  let id = "";
  let polls = 0;
  const server = createServer(async (request, response) => {
    if (request.method === "PUT") {
      id = request.url?.split("/").at(-1) ?? "";
      for await (const chunk of request) html += chunk.toString();
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ id, url: `https://viz.example.test/pages/${id}` }));
      return;
    }
    if (request.method === "GET" && request.url === `/api/pages/${id}/result`) {
      polls += 1;
      if (polls === 1) response.writeHead(204).end();
      else response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ answers: { q1: "A" } }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    const result = await run([], page, {
      HOME: directory,
      XDG_CONFIG_HOME: path.join(directory, "config"),
      VIZ_SERVER_URL: `http://127.0.0.1:${address.port}`,
      VIZ_TOKEN: TOKEN,
    }, directory);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "q1: A\n");
    const fileMatch = result.stderr.match(/local copy — (file:\/\/\S+)/);
    assert(fileMatch);
    assert.match(result.stderr, new RegExp(`waiting for answers — https://viz\\.example\\.test/pages/${id}`));
    assert.match(html, new RegExp(`/api/pages/${id}/answers`));
    const localHtml = await readFile(fileURLToPath(fileMatch[1]), "utf8");
    assert.doesNotMatch(localHtml, new RegExp(`/api/pages/${id}/answers`));
    assert.match(localHtml, /Copy answers/);
    assert.equal(polls, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("configured remote failures report the saved local copy and still fail", async () => {
  const directory = await temporaryDirectory();
  const result = await run(["--detach"], PAGE, {
    HOME: directory,
    XDG_CONFIG_HOME: path.join(directory, "config"),
    VIZ_SERVER_URL: "http://127.0.0.1:1",
    VIZ_TOKEN: TOKEN,
  }, directory);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /viz: remote upload failed.*use --local/);
  assert.match(result.stdout, /^file: file:\/\//);
  const localHtml = await readFile(fileURLToPath(result.stdout.trim().replace("file: ", "")), "utf8");
  assert.match(localHtml, /<h1>uploaded<\/h1>/);
});
