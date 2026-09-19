import { cp, mkdir, rm, readFile, access } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await cp("public", "dist", { recursive: true });
await mkdir("dist/vendor", { recursive: true });
for (const [source, target] of [
  ["build/three.module.js", "three.module.js"],
  ["build/three.core.js", "three.core.js"],
  ["examples/jsm/controls/OrbitControls.js", "OrbitControls.js"],
  ["examples/jsm/geometries/RoundedBoxGeometry.js", "RoundedBoxGeometry.js"],
])
  await cp("node_modules/three/" + source, "dist/vendor/" + target);
for (const r of JSON.parse(await readFile("dist/runs/manifest.json", "utf8")))
  for (const file of ["result.json", "trace.json", "rollout.mp4"])
    await access(`dist/runs/${r.id}/${file}`);
console.log(
  "Built static demo + workcell in dist/. Vercel discovers api/*.js separately.",
);
