"""Installed, pinned task catalog and browser-request validation."""
import ast
from pathlib import Path
import re


def catalog(libero_root, assets_root):
    import torch
    source = Path(libero_root) / "libero/libero/benchmark/libero_suite_task_map.py"
    tree = ast.parse(source.read_text())
    mapping = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == "libero_task_map" for t in n.targets))
    tasks = []
    # PRO suites use declaration order at this revision; standard suites reorder.
    for suite in ("libero_spatial_swap", "libero_object_swap", "libero_goal_swap"):
        for task_id, name in enumerate(mapping.get(suite, [])):
            bddl = Path(assets_root) / "bddl_files" / suite / (name + ".bddl")
            initial = Path(assets_root) / "init_files" / suite / (name + ".pruned_init")
            if not bddl.is_file() or not initial.is_file():
                continue
            match = re.search(r"\(:language\s+([^)]*)\)", bddl.read_text(), re.I)
            if not match:
                continue
            # These are the trusted pinned dataset files, never browser uploads.
            count = len(torch.load(initial, map_location="cpu"))
            tasks.append({"suite": suite, "task_id": task_id, "name": name,
                          "instruction": " ".join(match[1].split()), "initial_states": count})
    return tasks


def validate_request(data, tasks):
    if not isinstance(data, dict) or set(data) - {"suite", "task_id", "init_index", "seed", "instruction", "max_calls"}:
        raise ValueError("Unknown task settings")
    suite = data.get("suite", "libero_spatial_swap")
    task_id = data.get("task_id", 0)
    if type(task_id) is not int:
        raise ValueError("Task ID must be an integer")
    task = next((t for t in tasks if t["suite"] == suite and t["task_id"] == task_id), None)
    if task is None:
        raise ValueError("Select an installed task")
    result = {"suite": suite, "task_id": task_id}
    for key, default, low, high in (("init_index", 0, 0, task["initial_states"] - 1),
                                   ("seed", 7, 0, 2147483647), ("max_calls", 44, 1, 80)):
        value = data.get(key, default)
        if type(value) is not int or not low <= value <= high:
            raise ValueError("Invalid " + key)
        result[key] = value
    instruction = data.get("instruction", "")
    if not isinstance(instruction, str) or len(instruction) > 1600 or "\x00" in instruction:
        raise ValueError("Instruction must be at most 1600 characters")
    result["instruction"] = instruction.strip()
    return result


def scoring_mode(instruction, environment_instruction, query_only=False):
    if query_only:
        return "query_only"
    if instruction and instruction.strip().casefold() != environment_instruction.strip().casefold():
        return "custom_unscored"
    return "environment_goal"


def observe_goal(result, done):
    """An environment goal may only complete the original environment task."""
    result["environment_goal_reached"] |= bool(done)
    if done and result["evaluation_mode"] == "environment_goal":
        result["success"] = True
        result["termination"] = "simulator_success"
        return True
    return False
