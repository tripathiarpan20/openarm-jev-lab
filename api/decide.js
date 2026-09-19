import { decide, validateScene } from "../jev.mjs";
import { authorize, json, readBody } from "../lib/http.mjs";
export default async function handler(req, res) {
  if (req.method !== "POST")
    return json(res, 405, { error: "Method not allowed" });
  if (!authorize(req, res)) return;
  const token = process.env.CLOUDFLARE_API_TOKEN,
    accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !/^[a-f0-9]{32}$/i.test(accountId ?? ""))
    return json(res, 503, {
      error: "Configure Cloudflare credentials on the server.",
    });
  let scene;
  try {
    scene = validateScene(await readBody(req));
  } catch {
    return json(res, 400, { error: "Invalid scene or JSON body" });
  }
  try {
    return json(res, 200, await decide(scene, { token, accountId }));
  } catch {
    return json(res, 502, {
      error: "Jev request failed. No fallback action was executed.",
    });
  }
}
