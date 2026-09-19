import { timingSafeEqual } from "node:crypto";
export function json(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.statusCode = status;
  res.end(JSON.stringify(data));
}
export function authorize(req, res) {
  const secret = process.env.DEMO_ACCESS_KEY;
  if (process.env.VERCEL && (!secret || secret.length < 24)) {
    json(res, 503, {
      error:
        "Live calls are disabled. Set DEMO_ACCESS_KEY (24+ characters) on the server.",
    });
    return false;
  }
  if (secret) {
    const got = Buffer.from(req.headers["x-demo-key"] || ""),
      want = Buffer.from(secret);
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      json(res, 401, {
        error: "Enter the demo access key to make live calls.",
      });
      return false;
    }
  }
  // A browser Origin must match this deployment; non-browser clients still need the key.
  if (req.headers.origin) {
    let host;
    try {
      host = new URL(req.headers.origin).host;
    } catch {}
    if (host !== req.headers.host) {
      json(res, 403, { error: "Origin not allowed." });
      return false;
    }
  }
  return true;
}
export async function readBody(req, max = 24000) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw Error("JSON required");
  if (req.body !== undefined) {
    const body =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(body) > max) throw Error("Body too large");
    return JSON.parse(body);
  }
  const chunks = [];
  let length = 0;
  for await (const c of req) {
    length += c.length;
    if (length > max) throw Error("Body too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
