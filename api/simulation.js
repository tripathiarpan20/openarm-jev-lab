import { authorize, json, readBody } from "../lib/http.mjs";
export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method))
    return json(res, 405, { error: "Method not allowed" });
  const configured = Boolean(process.env.SIMULATOR_URL) || !process.env.VERCEL;
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.searchParams.get("op") === "config")
    return json(res, 200, {
      configured,
      requiresKey:
        Boolean(process.env.DEMO_ACCESS_KEY) || Boolean(process.env.VERCEL),
    });
  if (!authorize(req, res)) return;
  if (!configured)
    return json(res, 503, {
      error: "Live worker not configured. Recordings work without a worker.",
    });
  let op = url.searchParams.get("op") || "status",
    settings;
  if (req.method === "GET" && !["status", "tasks"].includes(op))
    return json(res, 400, { error: "Unknown read operation" });
  if (req.method === "POST") {
    try {
      const body = await readBody(req, 8000);
      op = body.op;
      if (
        !["start", "query", "stop"].includes(op) ||
        Object.keys(body).some((k) => !["op", "settings"].includes(k))
      )
        throw Error();
      settings = body.settings ?? {};
      if (op === "stop" && body.settings !== undefined) throw Error();
      if (
        !settings ||
        typeof settings !== "object" ||
        Array.isArray(settings) ||
        Object.keys(settings).some(
          (k) =>
            ![
              "suite",
              "task_id",
              "init_index",
              "seed",
              "instruction",
              "max_calls",
            ].includes(k),
        )
      )
        throw Error();
      for (const [k, low, high] of [
        ["task_id", 0, 1000],
        ["init_index", 0, 100000],
        ["seed", 0, 2147483647],
        ["max_calls", 1, 80],
      ]) {
        if (
          settings[k] !== undefined &&
          (!Number.isInteger(settings[k]) ||
            settings[k] < low ||
            settings[k] > high)
        )
          throw Error();
      }
      if (
        settings.suite !== undefined &&
        !/^libero_(spatial|object|goal)_swap$/.test(settings.suite)
      )
        throw Error();
      if (
        settings.instruction !== undefined &&
        (typeof settings.instruction !== "string" ||
          settings.instruction.length > 1600 ||
          settings.instruction.includes("\0"))
      )
        throw Error();
    } catch {
      return json(res, 400, { error: "Invalid task settings or operation" });
    }
  }
  let target;
  try {
    target = new URL(process.env.SIMULATOR_URL || "http://127.0.0.1:8788");
    if (
      target.username ||
      target.password ||
      !(
        target.protocol === "https:" ||
        (target.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
      )
    )
      throw Error();
  } catch {
    return json(res, 503, {
      error: "Worker URL must use HTTPS (or loopback HTTP locally).",
    });
  }
  if (
    process.env.VERCEL &&
    (!process.env.SIMULATOR_TOKEN || process.env.SIMULATOR_TOKEN.length < 24)
  )
    return json(res, 503, { error: "Set the private worker token on Vercel." });
  try {
    const response = await fetch(new URL("/" + op, target), {
      method: req.method,
      headers: {
        "X-Jev-Lab": "simulation-proxy",
        "Content-Type": "application/json",
        ...(process.env.SIMULATOR_TOKEN
          ? { Authorization: `Bearer ${process.env.SIMULATOR_TOKEN}` }
          : {}),
      },
      ...(req.method === "POST" ? { body: JSON.stringify(settings) } : {}),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok)
      return json(
        res,
        [400, 409].includes(response.status) ? response.status : 502,
        {
          error:
            response.status === 409
              ? "A simulation is already running."
              : response.status === 400
                ? "Invalid settings for the installed task."
                : "The simulator worker rejected the request.",
        },
      );
    return json(res, 200, await response.json());
  } catch {
    return json(res, 502, {
      error:
        "Cannot reach the simulator worker. Start it locally or configure SIMULATOR_URL on Vercel.",
    });
  }
}
