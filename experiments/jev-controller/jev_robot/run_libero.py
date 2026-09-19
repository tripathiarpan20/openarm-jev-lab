"""One real LIBERO rollout with explicit oracle/proprio observations and artifacts.

This is an experimental client of the same simulator, NOT an official scoring run.
It adds oracle observations only when explicitly selected. No reward, goal
predicate or task-specific movement script is provided to Jev.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import numpy as np

from .cloudflare import CloudflareJev, JevError, load_env
from .policy import JevPolicy

LIBERO_REF = "eafdb809426b13153aa1e4c42d6601844217dfec"


def configure_libero(root, out, assets=None):
    root = Path(root).resolve()
    revision = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    if revision != LIBERO_REF:
        raise ValueError("LIBERO-Pro checkout must be pinned to " + LIBERO_REF)
    import yaml
    package = root / "libero" / "libero"
    config = out / "libero-config"
    config.mkdir(parents=True, exist_ok=True)
    data_root = Path(assets).resolve() if assets else package
    values = {"benchmark_root": str(package), "bddl_files": str(data_root / "bddl_files"),
              "init_states": str(data_root / "init_files"), "assets": str(package / "assets"),
              "datasets": str(out)}
    (config / "config.yaml").write_text(yaml.safe_dump(values))
    os.environ["LIBERO_CONFIG_PATH"] = str(config)
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("NUMBA_CACHE_DIR", str(out / "numba-cache"))
    if sys.platform == "linux":
        os.environ.setdefault("MUJOCO_GL", "egl")
    sys.path.insert(0, str(root))
    return revision


def axis_angle(quat):
    quat = np.asarray(quat, dtype=float)
    w = float(np.clip(quat[3], -1, 1))
    den = np.sqrt(1 - w * w)
    return np.zeros(3) if den < 1e-8 else quat[:3] * 2 * np.arccos(w) / den


def oracle_scene(env):
    raw = env.env
    sim = raw.sim
    robot = raw.robots[0]
    grip_site = robot.gripper.important_sites["grip_site"]
    eef = sim.data.site_xpos[sim.model.site_name2id(grip_site)]
    objects = []
    for name, body_id in sorted(raw.obj_body_id.items()):
        obj = raw.objects_dict.get(name, raw.fixtures_dict.get(name))
        item = {"name": name, "position_world_m": sim.data.body_xpos[body_id].round(5).tolist(),
                "delta_from_eef_world_m": (sim.data.body_xpos[body_id] - eef).round(5).tolist(),
                "quaternion_wxyz": sim.data.body_xquat[body_id].round(5).tolist(),
                "fixture": name in raw.fixtures_dict}
        if obj is not None:
            bounds = []
            for geom_name in obj.contact_geoms:
                gid = sim.model.geom_name2id(geom_name)
                # MuJoCo's compiled local AABB includes mesh scaling and centering.
                box = sim.model.geom_aabb[gid]
                mat = sim.data.geom_xmat[gid].reshape(3, 3)
                center = sim.data.geom_xpos[gid] + mat @ box[:3]
                extent = np.abs(mat) @ box[3:]
                bounds.extend([center - extent, center + extent])
            if bounds:
                item["collision_bounds_world_m"] = [np.min(bounds, axis=0).round(5).tolist(), np.max(bounds, axis=0).round(5).tolist()]
            item["bottom_offset_m"] = np.asarray(obj.bottom_offset).round(5).tolist()
            item["top_offset_m"] = np.asarray(obj.top_offset).round(5).tolist()
            if name in raw.objects_dict:
                item["both_fingers_in_contact"] = bool(raw._check_grasp(robot.gripper, obj))
        objects.append(item)
    sites = []
    for name in sorted(raw.object_sites_dict):
        # Initial-placement regions are stale after swaps/motion. They aren't
        # observed object positions and would misleadingly encode original layout.
        if name.startswith("main_table_"):
            continue
        site_id = sim.model.site_name2id(name)
        sites.append({"name": name, "position_world_m": sim.data.site_xpos[site_id].round(5).tolist(),
                      "half_size_m": sim.model.site_size[site_id].round(5).tolist()})
    return {"source": "simulator_ground_truth", "objects": objects, "sites": sites,
            "grasp_site_world_m": sim.data.site_xpos[sim.model.site_name2id(grip_site)].round(5).tolist(),
            "controller_output_min": robot.controller.output_min.tolist(),
            "controller_output_max": robot.controller.output_max.tolist(),
            "control_frequency_hz": raw.control_freq,
            "gripper_closing_axis_world": sim.data.xaxis[sim.model.joint_name2id(robot.gripper.joints[0])].round(5).tolist(),
            "note": "Privileged simulator measurements, not extracted from RGB. No success predicates supplied."}


def observation(obs, prompt, suite, env, mode):
    state = np.concatenate((obs["robot0_eef_pos"], axis_angle(obs["robot0_eef_quat"]), obs["robot0_gripper_qpos"]))
    element = {"observation/state": state, "prompt": prompt, "task_suite": suite,
               "observation/image": np.ascontiguousarray(obs["agentview_image"][::-1, ::-1]),
               "observation/wrist_image": np.ascontiguousarray(obs["robot0_eye_in_hand_image"][::-1, ::-1])}
    if mode == "sim-oracle":
        element["observation/scene"] = oracle_scene(env)
    return element


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--libero-root", required=True)
    p.add_argument("--assets-root", help="Optional directory containing downloaded bddl_files and init_files")
    p.add_argument("--suite", default="libero_spatial")
    p.add_argument("--task-id", type=int, default=0)
    p.add_argument("--init-index", type=int, default=0)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--observation-mode", choices=("sim-oracle", "proprio"), required=True)
    p.add_argument("--env-file")
    p.add_argument("--instruction", default="", help="Override instruction; a changed goal is explicitly unscored")
    p.add_argument("--query-only", action="store_true", help="Ask Jev once without executing its proposed actions")
    p.add_argument("--max-calls", type=int, default=40)
    p.add_argument("--action-set", choices=("discrete", "grounded"), default="discrete")
    p.add_argument("--horizon", type=int, default=5)
    p.add_argument("--max-steps", type=int, default=220)
    p.add_argument("--confidence-floor", type=float, default=0)
    p.add_argument("--output", default="artifacts/" + time.strftime("%Y%m%d-%H%M%S"))
    p.add_argument("--server", help="Use the websocket adapter, e.g. ws://127.0.0.1:8000")
    p.add_argument("--sim-smoke", action="store_true", help="10 fixed hold steps, no Jev calls; simulator installation check only")
    args = p.parse_args()
    if args.max_steps < 1 or args.init_index < 0:
        p.error("max-steps must be positive and init-index nonnegative")
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=False)
    revision = configure_libero(args.libero_root, out, args.assets_root)
    from libero.libero import benchmark, get_libero_path
    from libero.libero.envs import OffScreenRenderEnv
    import imageio.v2 as imageio
    np.random.seed(args.seed)
    suites = benchmark.get_benchmark_dict()
    if args.suite not in suites:
        raise ValueError("Unknown suite: " + args.suite)
    suite = suites[args.suite]()
    if not 0 <= args.task_id < suite.n_tasks:
        raise ValueError("Invalid task ID")
    task = suite.get_task(args.task_id)
    states = suite.get_task_init_states(args.task_id)
    if args.init_index >= len(states):
        raise ValueError("Invalid initial-state index")
    env = OffScreenRenderEnv(bddl_file_name=str(Path(get_libero_path("bddl_files")) / task.problem_folder / task.bddl_file),
                            camera_heights=256, camera_widths=256)
    env.seed(args.seed)
    env.reset()
    obs = env.set_init_state(states[args.init_index])
    environment_instruction = str(env.language_instruction)
    from .tasks import scoring_mode, observe_goal
    evaluation_mode = scoring_mode(args.instruction, environment_instruction, args.query_only)
    prompt = args.instruction.strip() or environment_instruction
    for _ in range(10):
        obs, _, _, _ = env.step([0.] * 6 + [-1.])
    policy = None
    ws = None
    metadata = {"policy": "fixed-hold-simulator-smoke", "privileged_observations": False}
    if not args.sim_smoke:
        if args.server:
            from websockets.sync.client import connect
            from .wire import pack, unpack
            ws = connect(args.server, compression=None, max_size=8 * 1024 * 1024)
            metadata = unpack(ws.recv())
            if metadata.get("observation_mode") != args.observation_mode or metadata.get("action_horizon") != args.horizon or metadata.get("action_set", "discrete") != args.action_set:
                ws.close()
                env.close()
                raise ValueError("Server mode/horizon/action set differs from runner")
        else:
            load_env(args.env_file)
            policy = JevPolicy(CloudflareJev(), args.observation_mode, args.horizon, args.max_calls, args.confidence_floor, args.action_set)
            metadata = policy.metadata
    result = {"experimental": True, "official_benchmark_comparable": False,
              "metadata": metadata, "libero_pro_revision": revision,
              "controller_source_sha256": {name: hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest()
                  for name in ("actions.py", "grounded.py", "policy.py", "cloudflare.py", "run_libero.py", "tasks.py")},
              "suite": args.suite,
              "task_id": args.task_id, "task_name": task.name, "prompt": prompt,
              "environment_instruction": environment_instruction, "evaluation_mode": evaluation_mode,
              "environment_goal_reached": False, "query_only": args.query_only,
              "seed": args.seed, "init_index": args.init_index, "steps": 0, "calls": 0,
              "success": False if evaluation_mode == "environment_goal" else None, "termination": "step_limit", "error": None,
              "horizon": args.horizon, "max_steps": args.max_steps, "max_calls": args.max_calls}
    start = time.monotonic()
    writer = imageio.get_writer(out / "rollout.mp4", fps=20, codec="libx264", quality=8)
    print("Task:", prompt, "| mode:", args.observation_mode, flush=True)
    def publish_frame():
        imageio.imwrite(out / "frame.tmp.jpg", np.ascontiguousarray(obs["agentview_image"][::-1]))
        (out / "frame.tmp.jpg").replace(out / "frame.jpg")
        snapshot = {**result, "termination": "running", "wall_seconds": round(time.monotonic() - start, 2)}
        (out / "live.tmp.json").write_text(json.dumps(snapshot))
        (out / "live.tmp.json").replace(out / "live.json")
    publish_frame()
    try:
        with (out / "decisions.jsonl").open("w") as log:
            while result["steps"] < (10 if args.sim_smoke else args.max_steps):
                packet = observation(obs, prompt, args.suite, env, args.observation_mode)
                if args.sim_smoke:
                    response = {"actions": np.asarray([[0.] * 6 + [-1.]])}
                else:
                    if result["calls"] >= args.max_calls:
                        result["termination"] = "call_budget"
                        break
                    result["calls"] += 1
                    if ws:
                        ws.send(pack(packet))
                        wire_response = ws.recv(timeout=40)
                        if isinstance(wire_response, str):
                            raise JevError(wire_response)
                        response = unpack(wire_response)
                    else:
                        response = policy.infer(packet)
                    record = {"call": result["calls"], "step": result["steps"],
                              "state": packet["observation/state"].tolist(),
                              "scene": packet.get("observation/scene"),
                              "jev": response["jev"], "timing": response["server_timing"],
                              "actions": response["actions"].tolist(), "executed": not args.query_only}
                    log.write(json.dumps(record) + "\n")
                    log.flush()
                    print("call=%d action=%s confidence=%.3f latency_ms=%.1f" %
                          (result["calls"], response["jev"]["choice"], response["jev"]["confidence"],
                           response["server_timing"]["infer_ms"]), flush=True)
                if args.query_only:
                    result["termination"] = "query_complete"
                    publish_frame()
                    break
                actions = np.asarray(response["actions"], dtype=float)
                if actions.ndim != 2 or actions.shape[1] != 7 or not np.isfinite(actions).all() or np.abs(actions).max() > 1:
                    raise JevError("Malformed action chunk")
                for action in actions:
                    writer.append_data(np.ascontiguousarray(obs["agentview_image"][::-1]))
                    obs, _, done, _ = env.step(action.tolist())
                    result["steps"] += 1
                    if observe_goal(result, done):
                        break
                    if result["steps"] >= args.max_steps:
                        break
                publish_frame()
                if result["success"]:
                    break
            writer.append_data(np.ascontiguousarray(obs["agentview_image"][::-1]))
            imageio.imwrite(out / "final.png", np.ascontiguousarray(obs["agentview_image"][::-1]))
    except Exception as exc:
        result["termination"] = "error"
        result["error"] = str(exc) if isinstance(exc, JevError) else type(exc).__name__
    finally:
        writer.close()
        if ws:
            ws.close()
        env.close()
        result["wall_seconds"] = round(time.monotonic() - start, 2)
        (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        from .replay import write_replay
        write_replay(out)
        print(json.dumps(result, indent=2), flush=True)
    if result["error"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
