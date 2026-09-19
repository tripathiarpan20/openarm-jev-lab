"""Fetch only a requested LIBERO-Pro suite at an explicit dataset revision."""
import argparse
import json
from pathlib import Path
from huggingface_hub import HfApi, snapshot_download

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--suite", required=True)
p.add_argument("--revision", help="Dataset commit; resolved and recorded when omitted")
p.add_argument("--output", default="third_party/pro-assets")
a = p.parse_args()
supported = {f"libero_{base}_{d}" for base in ("spatial", "object", "goal", "10")
             for d in ("object", "swap", "lan", "task")}
if a.suite not in supported:
    p.error("Choose one of the 16 published LIBERO-Pro suites")
repo = "zhouxueyang/LIBERO-Pro"
revision = a.revision or HfApi().dataset_info(repo).sha
out = Path(a.output)
snapshot_download(repo_id=repo, repo_type="dataset", revision=revision, local_dir=out,
                  allow_patterns=[f"bddl_files/{a.suite}/*", f"init_files/{a.suite}/*"])
for folder in ("bddl_files", "init_files"):
    if not list((out / folder / a.suite).glob("*")):
        raise RuntimeError("Dataset layout mismatch: " + folder)
(out / (a.suite + "-provenance.json")).write_text(json.dumps(
    {"repo": repo, "revision": revision, "suite": a.suite}, indent=2) + "\n")
print("Downloaded", a.suite, "at", revision, "into", out)
