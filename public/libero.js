const $ = (id) => document.getElementById(id),
  video = $("video");
let trace = [],
  result = null,
  index = 0,
  requestId = 0,
  live = false,
  pollTimer = null;
const text = (id, value) => ($(id).textContent = value);
const title = (s) => s.replaceAll("__", " · ").replaceAll("_", " ");
const median = (xs) => {
  const a = [...xs].sort((a, b) => a - b),
    m = Math.floor(a.length / 2);
  return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : 0;
};
function notice(message) {
  text("notice", message);
  $("notice").hidden = !message;
}
function displayDecision(d) {
  if (!d) return;
  text("call", `CALL ${d.call} / ${result?.calls ?? "—"}`);
  text("choice", title(d.jev.choice));
  text(
    "description",
    d.jev.selected_description ??
      "Fixed direction repeated for five simulator steps. The next choice uses a fresh observation.",
  );
  text("confidence", `${(d.jev.confidence * 100).toFixed(0)}%`);
  text("latency", `${Math.round(d.timing.infer_ms)} ms`);
  text("grip", d.actions[0][6] > 0 ? "CLOSE COMMANDED" : "OPEN COMMANDED");
  $("axes").replaceChildren();
  for (let a = 0; a < 3; a++) {
    const row = document.createElement("div");
    row.className = "axis";
    const label = document.createElement("span");
    label.textContent = "XYZ"[a];
    const track = document.createElement("div");
    track.className = "axis-track";
    const fill = document.createElement("span");
    fill.className = "axis-fill";
    const n = d.actions[0][a];
    fill.style.width = `${Math.abs(n) * 50}%`;
    fill.style.left = `${n < 0 ? 50 + n * 50 : 50}%`;
    track.append(fill);
    const value = document.createElement("span");
    value.textContent = n.toFixed(3);
    row.append(label, track, value);
    $("axes").append(row);
  }
  $("probabilities").replaceChildren();
  for (const [choice, prob] of Object.entries(d.jev.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)) {
    const row = document.createElement("div");
    row.className = "prob";
    const label = document.createElement("div");
    label.className = "prob-label";
    const name = document.createElement("span");
    name.textContent = title(choice);
    const value = document.createElement("span");
    value.textContent = `${(prob * 100).toFixed(1)}%`;
    label.append(name, value);
    const track = document.createElement("div");
    track.className = "prob-track";
    const fill = document.createElement("span");
    fill.style.width = `${prob * 100}%`;
    track.append(fill);
    row.append(label, track);
    $("probabilities").append(row);
  }
}
function displayResult(r, rows) {
  result = r;
  text("task", r.prompt);
  text("calls", r.calls);
  text("steps", r.steps);
  text("wall", r.wall_seconds ? `${r.wall_seconds.toFixed(1)} s` : "Running");
  text(
    "median",
    rows.length
      ? `${Math.round(median(rows.map((d) => d.timing.infer_ms)))} ms`
      : "—",
  );
  text(
    "outcome",
    r.success
      ? "Task completed"
      : r.termination === "running"
        ? "Running"
        : r.termination === "error"
          ? "Run error"
          : "Task not completed",
  );
  $("outcome").classList.toggle("success", r.success);
}
function update() {
  if (live || !trace.length) return;
  const step = Math.floor(video.currentTime * 20);
  index = 0;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i].step <= step) index = i;
    else break;
  }
  displayDecision(trace[index]);
  $("scrub").value = video.currentTime;
  text(
    "time",
    `${video.currentTime.toFixed(1)} / ${(video.duration || 0).toFixed(1)} s`,
  );
  text("play", video.paused ? "▶ Play run" : "Ⅱ Pause");
}
async function loadRun(id) {
  live = false;
  clearTimeout(pollTimer);
  $("video").hidden = false;
  $("live-frame").hidden = true;
  text("source", "● RECORDED SIMULATION");
  text(
    "video-note",
    "Actual simulator recording. Playback omits API waiting time.",
  );
  for (const id of ["scrub", "prev", "next", "restart", "speed"])
    $(id).disabled = false;
  const current = ++requestId;
  video.pause();
  notice("");
  $("play").disabled = true;
  const base = `/runs/${encodeURIComponent(id)}`;
  try {
    const [rr, tr] = await Promise.all([
      fetch(`${base}/result.json`),
      fetch(`${base}/trace.json`),
    ]);
    if (!rr.ok || !tr.ok) throw Error("Recording unavailable. Please reload.");
    const [r, t] = await Promise.all([rr.json(), tr.json()]);
    if (current !== requestId) return;
    trace = t;
    index = 0;
    displayResult(r, t);
    $("result-link").href = `${base}/result.json`;
    video.src = `${base}/rollout.mp4`;
    video.poster = `${base}/final.png`;
    $("play").disabled = false;
    displayDecision(t[0]);
  } catch (e) {
    notice(e.message);
  }
}
video.addEventListener("timeupdate", update);
video.addEventListener("loadedmetadata", () => {
  $("scrub").max = video.duration;
  update();
});
video.addEventListener("ended", update);
video.addEventListener("error", () =>
  notice("The recording could not be loaded. Try another run."),
);
$("play").onclick = async () => {
  try {
    if (video.paused) await video.play();
    else video.pause();
    update();
  } catch {
    notice("Playback could not start. Please try again.");
  }
};
$("restart").onclick = () => {
  video.currentTime = 0;
  update();
};
$("scrub").oninput = () => {
  video.currentTime = Number($("scrub").value);
  update();
};
$("speed").onchange = () => (video.playbackRate = Number($("speed").value));
function seekDecision(i) {
  if (!trace.length) return;
  video.pause();
  index = Math.max(0, Math.min(trace.length - 1, i));
  video.currentTime = trace[index].step / 20;
  update();
}
$("prev").onclick = () => seekDecision(index - 1);
$("next").onclick = () => seekDecision(index + 1);
$("run").onchange = () => loadRun($("run").value);
try {
  const response = await fetch("/runs/manifest.json");
  if (!response.ok) throw Error();
  const runs = await response.json();
  $("run").replaceChildren(...runs.map((r) => new Option(r.name, r.id)));
  $("run").disabled = false;
  await loadRun(runs[0].id);
} catch {
  notice("Run catalog unavailable. Check the web server and reload.");
}

async function simulation(method = "GET", op = "status") {
  const response = await fetch(
    "/api/simulation" + (method === "GET" ? `?op=${op}` : ""),
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Demo-Key": $("access-key").value,
      },
      ...(method === "POST" ? { body: JSON.stringify({ op }) } : {}),
    },
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Simulation request failed");
  return data;
}
function liveControls(active) {
  $("start-live").disabled = active;
  $("stop-live").disabled = !active;
  $("run").disabled = active;
}
async function pollLive() {
  if (!live) return;
  const generation = requestId;
  try {
    const state = await simulation();
    if (!live || generation !== requestId) return;
    text(
      "worker-status",
      state.smoke
        ? "Simulator installation check · no Jev calls"
        : state.status,
    );
    if (state.frame) {
      $("live-frame").src = state.frame;
      $("live-frame").hidden = false;
    }
    if (state.result) {
      trace = state.decisions ?? [];
      displayResult(state.result, trace);
      displayDecision(trace.at(-1));
      text("time", `${(state.result.steps / 20).toFixed(1)} s`);
    }
    if (["running", "starting"].includes(state.status))
      pollTimer = setTimeout(pollLive, 700);
    else {
      liveControls(false);
      $("return-recording").hidden = false;
      if (state.error) notice(state.error);
      text(
        "video-note",
        "Live run ended. The worker retains full video and JSON logs in its artifacts folder.",
      );
    }
  } catch (e) {
    notice(e.message);
    text(
      "worker-status",
      "Connection lost; the bounded worker may still be running. Reconnect or Stop.",
    );
    $("reconnect").hidden = false;
    $("stop-live").disabled = false;
  }
}
function enterLive(smoke = false) {
  requestId++;
  clearTimeout(pollTimer);
  live = true;
  trace = [];
  result = null;
  video.pause();
  $("video").hidden = true;
  $("live-frame").hidden = true;
  $("play").disabled = true;
  for (const id of ["scrub", "prev", "next", "restart", "speed"])
    $(id).disabled = true;
  for (const id of ["calls", "steps", "wall", "median", "time"]) text(id, "—");
  $("return-recording").hidden = true;
  $("reconnect").hidden = true;
  liveControls(true);
  text("source", smoke ? "● INSTALLATION CHECK — NO JEV" : "● LIVE SIMULATION");
}
async function startLive() {
  $("start-live").disabled = true;
  notice("");
  try {
    const state = await simulation("POST", "start");
    enterLive(state.smoke);
    text("choice", "Starting simulator…");
    text(
      "description",
      "Loading the pinned scene. Jev will choose each short movement.",
    );
    text("confidence", "—");
    text("latency", "—");
    text("call", "CALL —");
    $("axes").replaceChildren();
    $("probabilities").replaceChildren();
    text("grip", "—");
    text("outcome", "Starting");
    $("outcome").classList.remove("success");
    text(
      "video-note",
      "Live frames include model waiting time. One episode: at most 44 Jev requests / 220 simulation steps.",
    );
    text("worker-status", "Starting…");
    await pollLive();
  } catch (e) {
    liveControls(false);
    if (e.message.includes("already running")) $("reconnect").hidden = false;
    notice(e.message);
  }
}
$("live-toggle").disabled = false;
$("live-toggle").onclick = () => {
  $("live-panel").hidden = !$("live-panel").hidden;
  if (!$("live-panel").hidden)
    $("live-panel").scrollIntoView({ block: "nearest" });
};
$("start-live").onclick = startLive;
$("stop-live").onclick = async () => {
  try {
    clearTimeout(pollTimer);
    await simulation("POST", "stop");
    await pollLive();
  } catch (e) {
    notice(e.message);
  }
};
$("reconnect").onclick = () => {
  enterLive();
  notice("");
  pollLive();
};
$("return-recording").onclick = () => {
  $("return-recording").hidden = true;
  loadRun($("run").value);
};
try {
  const config = await simulation("GET", "config");
  text(
    "worker-status",
    config.configured
      ? "Worker available to connect"
      : "Playback only · configure a simulation worker for live runs",
  );
  $("start-live").disabled = !config.configured;
  $("access-key").parentElement.hidden = !config.requiresKey;
} catch {
  text(
    "worker-status",
    "Live API unavailable; recorded runs are still usable.",
  );
  $("start-live").disabled = true;
}
// Optional structured access to exactly the same recording controls.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
  const tool = {
    name: "inspect_recorded_decision",
    description:
      "Open a recorded experiment and inspect a numbered Jev choice. Does not start or stop a live simulation.",
    inputSchema: {
      type: "object",
      properties: {
        run: { type: "string" },
        call: { type: "integer", minimum: 1 },
      },
      required: ["run", "call"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) {
      if (
        live ||
        !input ||
        !Number.isInteger(input.call) ||
        input.call < 1 ||
        ![...$("run").options].some((o) => o.value === input.run)
      )
        throw Error("Invalid recording/call, or live simulation is active");
      await loadRun(input.run);
      if (input.call > trace.length) throw Error("Call outside recording");
      $("run").value = input.run;
      seekDecision(input.call - 1);
      return {
        call: trace[index].call,
        choice: trace[index].jev.choice,
        success: result.success,
      };
    },
  };
  try {
    Promise.resolve(
      document.modelContext.registerTool(tool, { signal: lifecycle.signal }),
    ).catch(() => {});
  } catch {}
}
