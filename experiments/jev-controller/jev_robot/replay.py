"""Small offline viewer for measured trial artifacts, never a simulated replay."""
import json


def write_replay(out):
    result = json.loads((out / "result.json").read_text())
    log = out / "decisions.jsonl"
    decisions = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
    data = json.dumps({"result": result, "decisions": decisions}).replace("<", "\\u003c")
    html = '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jev × LIBERO — recorded trial</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0b1018;color:#e7edf5}
body{max-width:1120px;margin:40px auto;padding:0 24px}h1{font-size:32px;margin:8px 0}p{color:#acbbcb;line-height:1.5}
.tag{color:#82dcbe;font-size:12px;letter-spacing:.12em}main{display:grid;grid-template-columns:1.2fr 1fr;gap:24px;margin-top:28px}
video{width:100%;background:#000;border-radius:16px;image-rendering:auto}section{background:#141e2b;border:1px solid #25364a;border-radius:16px;padding:24px}
.stats{display:flex;gap:32px;margin:24px 0}.stats b{display:block;font-size:24px}label{color:#9eaec1;font-size:12px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:#c5d1e0}#action{font-size:21px;color:#82dcbe;overflow-wrap:anywhere}a{color:#a9caff}
@media(max-width:760px){main{grid-template-columns:1fr}.stats{gap:20px}}
</style>
<div class="tag">JEV × OPENROBOTO / LIBERO</div><h1>Recorded movement-control experiment</h1>
<p id="task"></p><p id="boundary"></p>
<div class="stats"><div><label>MODEL CALLS</label><b id="calls"></b></div><div><label>SIMULATION STEPS</label><b id="steps"></b></div><div><label>OUTCOME</label><b id="outcome"></b></div></div>
<main><div><video id="video" src="rollout.mp4" controls playsinline preload="metadata"></video>
<p>The video is the actual MuJoCo recording. Playback follows simulation time; API wait time is omitted.</p>
<p><a href="result.json">Result JSON</a> · <a href="decisions.jsonl">Decision log</a></p></div>
<section><label>JEV CHOICE AT THIS FRAME</label><h2 id="action">Play or scrub the video</h2><p id="metrics"></p><pre id="state"></pre></section></main>
<script id="data" type="application/json">__DATA__</script>
<script>
const data=JSON.parse(document.querySelector('#data').textContent),r=data.result;
const set=(id,text)=>document.getElementById(id).textContent=text;
set('task',r.prompt);set('calls',r.calls);set('steps',r.steps);
set('outcome',r.query_only?'Query only; no actions executed':r.evaluation_mode==='custom_unscored'?'Custom instruction; unscored':r.success?'Success':'Not completed');
set('boundary',(r.metadata.privileged_observations?'Uses privileged simulator object poses. ':'Proprioception only. ')
+'Experimental policy adapter; not an official miner score. Wall time: '+r.wall_seconds+' s.');
const video=document.querySelector('video');
function update(){const step=Math.floor(video.currentTime*20);let selected=data.decisions[0];
for(const d of data.decisions){if(d.step<=step)selected=d;else break;}
if(!selected)return;
set('action',selected.jev.choice);set('metrics','Call '+selected.call+' · confidence '+selected.jev.confidence.toFixed(2)+' · '+selected.timing.infer_ms.toFixed(0)+' ms');
set('state',JSON.stringify({end_effector_xyz_m:selected.state.slice(0,3),command:selected.actions[0],chunk_steps:selected.actions.length,served_model:selected.jev.served_model},null,2));}
video.addEventListener('timeupdate',update);video.addEventListener('loadedmetadata',update);update();
</script></html>'''
    (out / "index.html").write_text(html.replace("__DATA__", data))
