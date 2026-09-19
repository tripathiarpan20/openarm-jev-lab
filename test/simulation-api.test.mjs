import { test } from "node:test";
import assert from "node:assert/strict";
import simulation from "../api/simulation.js";
import decision from "../api/decide.js";
const secret = "test-only-key-with-at-least-24-chars";
async function invoke(
  handler,
  { method = "GET", url = "/api/simulation", body, headers = {} } = {},
) {
  let output;
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(s) {
      output = { status: this.statusCode, body: JSON.parse(s) };
    },
  };
  await handler(
    {
      method,
      url,
      body,
      headers: {
        host: "demo.example",
        "content-type": "application/json",
        ...headers,
      },
    },
    res,
  );
  return output;
}
test("hosted live calls fail closed, validate origin and do not expose credentials", async () => {
  const old = { ...process.env };
  const original = globalThis.fetch;
  let requests = 0;
  try {
    process.env.VERCEL = "1";
    delete process.env.DEMO_ACCESS_KEY;
    process.env.SIMULATOR_URL = "https://worker.example";
    process.env.SIMULATOR_TOKEN = secret;
    globalThis.fetch = async () => {
      requests++;
      throw Error("upstream-secret");
    };
    assert.equal((await invoke(simulation)).status, 503);
    process.env.DEMO_ACCESS_KEY = secret;
    assert.equal((await invoke(simulation)).status, 401);
    assert.equal(
      (
        await invoke(simulation, {
          headers: { "x-demo-key": secret, origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal(requests, 0);
    const failed = await invoke(simulation, {
      headers: { "x-demo-key": secret, origin: "https://demo.example" },
    });
    assert.equal(failed.status, 502);
    assert(!JSON.stringify(failed).includes("upstream-secret"));
  } finally {
    globalThis.fetch = original;
    for (const k of Object.keys(process.env))
      if (!(k in old)) delete process.env[k];
    Object.assign(process.env, old);
  }
});
test("proxy accepts only bounded operations at the configured worker and passes its private token", async () => {
  const old = { ...process.env };
  const original = globalThis.fetch;
  let sent;
  try {
    delete process.env.VERCEL;
    process.env.DEMO_ACCESS_KEY = secret;
    process.env.SIMULATOR_URL = "https://worker.example/base";
    process.env.SIMULATOR_TOKEN = secret;
    globalThis.fetch = async (url, options) => {
      sent = { url: String(url), options };
      return { ok: true, json: async () => ({ status: "starting" }) };
    };
    const headers = { "x-demo-key": secret };
    assert.equal(
      (
        await invoke(simulation, {
          method: "POST",
          body: { op: "start", command: "anything" },
          headers,
        })
      ).status,
      400,
    );
    assert.equal(sent, undefined);
    assert.equal(
      (
        await invoke(simulation, {
          method: "POST",
          body: { op: "start" },
          headers,
        })
      ).status,
      200,
    );
    assert.equal(sent.url, "https://worker.example/start");
    assert.equal(sent.options.headers.Authorization, `Bearer ${secret}`);
    assert.equal(sent.options.redirect, "error");
    process.env.SIMULATOR_URL = "http://public-worker.example";
    assert.equal((await invoke(simulation, { headers })).status, 503);
  } finally {
    globalThis.fetch = original;
    for (const k of Object.keys(process.env))
      if (!(k in old)) delete process.env[k];
    Object.assign(process.env, old);
  }
});
test("legacy workcell function also requires the hosted demo key before model inference", async () => {
  const old = { ...process.env };
  try {
    process.env.VERCEL = "1";
    process.env.DEMO_ACCESS_KEY = secret;
    assert.equal(
      (await invoke(decision, { method: "POST", body: {} })).status,
      401,
    );
  } finally {
    for (const k of Object.keys(process.env))
      if (!(k in old)) delete process.env[k];
    Object.assign(process.env, old);
  }
});

test("forwards task catalog and query settings while rejecting unexpected task fields", async () => {
  const old = { ...process.env },
    original = globalThis.fetch;
  let sent;
  try {
    delete process.env.VERCEL;
    delete process.env.DEMO_ACCESS_KEY;
    process.env.SIMULATOR_URL = "http://127.0.0.1:8788";
    globalThis.fetch = async (url, options) => {
      sent = { url: String(url), options };
      return { ok: true, json: async () => ({ tasks: [] }) };
    };
    await invoke(simulation, { url: "/api/simulation?op=tasks" });
    assert.equal(sent.url, "http://127.0.0.1:8788/tasks");
    const settings = {
      suite: "libero_spatial_swap",
      task_id: 3,
      init_index: 1,
      seed: 9,
      instruction: "Move the other bowl",
      max_calls: 2,
    };
    assert.equal(
      (
        await invoke(simulation, {
          method: "POST",
          body: { op: "query", settings },
        })
      ).status,
      200,
    );
    assert.equal(sent.url, "http://127.0.0.1:8788/query");
    assert.deepEqual(JSON.parse(sent.options.body), settings);
    for (const bad of [
      { ...settings, max_calls: 81 },
      { ...settings, command: "ls" },
      { ...settings, task_id: true },
      { ...settings, instruction: "a".repeat(1601) },
    ])
      assert.equal(
        (
          await invoke(simulation, {
            method: "POST",
            body: { op: "start", settings: bad },
          })
        ).status,
        400,
      );
  } finally {
    globalThis.fetch = original;
    for (const k of Object.keys(process.env))
      if (!(k in old)) delete process.env[k];
    Object.assign(process.env, old);
  }
});
