import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
const [directory, id, label] = process.argv.slice(2);
if (!directory || !id || !label || !/^[a-z0-9-]+$/.test(id))
  throw Error(
    "Usage: node scripts/export-run.mjs <artifact-directory> <slug> <label>",
  );
const result = JSON.parse(
  await readFile(path.join(directory, "result.json"), "utf8"),
);
const raw = await readFile(path.join(directory, "decisions.jsonl"), "utf8");
const trace = raw
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
if (!result.metadata || typeof result.success !== "boolean" || !trace.length)
  throw Error("Not a measured Jev rollout");
const dest = path.join("public", "runs", id);
await mkdir(dest, { recursive: true });
for (const file of [
  "result.json",
  "decisions.jsonl",
  "rollout.mp4",
  "final.png",
])
  await copyFile(path.join(directory, file), path.join(dest, file));
await writeFile(path.join(dest, "trace.json"), JSON.stringify(trace));
const manifestPath = "public/runs/manifest.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await writeFile(
  manifestPath,
  JSON.stringify(
    [{ id, name: label }, ...manifest.filter((r) => r.id !== id)],
    null,
    2,
  ) + "\n",
);
console.log(
  `Exported ${id}: ${result.success ? "simulator success" : "not completed"}, ${result.calls} calls, ${result.steps} steps`,
);
