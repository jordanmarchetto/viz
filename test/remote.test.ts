import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, test } from "node:test";
import { generatePageId, uploadPage, waitForAnswers } from "../src/remote.ts";

const CONFIG = { serverUrl: "http://unused.test", token: "0123456789abcdef" };

describe("remote page upload", () => {
  test("generates UUID v4 page IDs", () => {
    assert.match(generatePageId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("uploads finished HTML and returns the public URL", async () => {
    let received = "";
    const server = createServer(async (request, response) => {
      assert.equal(request.method, "PUT");
      assert.match(request.url ?? "", /^\/api\/pages\/[0-9a-f-]+$/);
      assert.equal(request.headers.authorization, `Bearer ${CONFIG.token}`);
      assert.equal(request.headers["content-type"], "text/html; charset=utf-8");
      for await (const chunk of request) received += chunk.toString();
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: request.url?.split("/").at(-1), url: "https://viz.example.test/pages/id" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address === "object");

    try {
      const url = await uploadPage(
        { ...CONFIG, serverUrl: `http://127.0.0.1:${address.port}` },
        generatePageId(),
        "<!doctype html><h1>remote</h1>",
      );
      assert.equal(url, "https://viz.example.test/pages/id");
      assert.equal(received, "<!doctype html><h1>remote</h1>");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("reconnects after empty polls and transient failures", async () => {
    const responses: Array<Response | Error> = [
      new Response(null, { status: 204 }),
      new Error("brief disconnect"),
      new Response("temporary", { status: 503 }),
      new Response(JSON.stringify({ answers: { q1: "Remote works" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ];
    const requests: RequestInit[] = [];
    const fetchResult = async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      const next = responses.shift();
      if (next instanceof Error) throw next;
      assert(next);
      return next;
    };

    assert.deepEqual(
      await waitForAnswers(CONFIG, generatePageId(), 1_000, fetchResult, 0),
      { q1: "Remote works" },
    );
    assert.equal(requests.length, 4);
    assert.equal((requests[0].headers as Record<string, string>).Authorization, `Bearer ${CONFIG.token}`);
  });

  test("returns null when the overall timeout expires", async () => {
    const emptyPoll = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(null, { status: 204 });
    };
    assert.equal(await waitForAnswers(CONFIG, generatePageId(), 12, emptyPoll, 0), null);
  });

  test("rejects permanent result errors and malformed answers", async () => {
    const unauthorized = async () => new Response('{"error":"unauthorized"}', {
      status: 401,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(
      waitForAnswers(CONFIG, generatePageId(), 100, unauthorized, 0),
      /result request failed \(401\): unauthorized/,
    );

    const malformed = async () => new Response('{"answers":{"q1":42}}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(
      waitForAnswers(CONFIG, generatePageId(), 100, malformed, 0),
      /invalid answers/,
    );
  });

  test("reports server and response errors without falling back", async () => {
    const unauthorized = async () => new Response('{"error":"unauthorized"}', { status: 401 });
    await assert.rejects(
      uploadPage(CONFIG, generatePageId(), "<p>x</p>", unauthorized),
      /remote upload failed \(401\): unauthorized/,
    );

    const malformed = async () => new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
    await assert.rejects(
      uploadPage(CONFIG, generatePageId(), "<p>x</p>", malformed),
      /did not return a page URL/,
    );
  });
});
