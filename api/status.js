import { json } from "../lib/http.mjs";
export default function handler(req, res) {
  if (req.method !== "GET")
    return json(res, 405, { error: "Method not allowed" });
  return json(res, 200, {
    model: "typesafe/jev",
    configured: Boolean(
      process.env.CLOUDFLARE_API_TOKEN &&
        /^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? ""),
    ),
    requiresKey:
      Boolean(process.env.DEMO_ACCESS_KEY) || Boolean(process.env.VERCEL),
    message:
      "Configure Cloudflare credentials on the server to enable this workcell.",
  });
}
