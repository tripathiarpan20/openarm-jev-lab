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
  let op = "status";
  if (req.method === "POST") {
    try {
      const body = await readBody(req, 512);
      op = body.op;
      if (!["start", "stop"].includes(op) || Object.keys(body).length !== 1)
        throw Error();
    } catch {
      return json(res, 400, { error: "Expected start or stop operation" });
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
        ...(process.env.SIMULATOR_TOKEN
          ? { Authorization: `Bearer ${process.env.SIMULATOR_TOKEN}` }
          : {}),
      },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok)
      return json(res, response.status === 409 ? 409 : 502, {
        error:
          response.status === 409
            ? "A simulation is already running."
            : "The simulator worker rejected the request.",
      });
    return json(res, 200, await response.json());
  } catch {
    return json(res, 502, {
      error:
        "Cannot reach the simulator worker. Start it locally or configure SIMULATOR_URL on Vercel.",
    });
  }
}
