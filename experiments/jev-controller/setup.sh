#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v uv >/dev/null || { echo 'Install uv first: https://docs.astral.sh/uv/'; exit 1; }
mkdir -p third_party

checkout() {
  local url="$1" destination="$2" revision="$3"
  if [ ! -d "$destination" ]; then
    git clone "$url" "$destination"
    git -C "$destination" checkout --detach "$revision"
  fi
  local actual
  actual="$(git -C "$destination" rev-parse HEAD)"
  if [ "$actual" != "$revision" ]; then
    echo "Wrong revision in $destination; expected $revision, found $actual" >&2
    exit 1
  fi
}

checkout https://github.com/Zxy-MLlab/LIBERO-PRO.git third_party/LIBERO-PRO eafdb809426b13153aa1e4c42d6601844217dfec
if [ ! -d third_party/openpi ]; then
  git clone --filter=blob:none --no-checkout https://github.com/Physical-Intelligence/openpi.git third_party/openpi
  git -C third_party/openpi sparse-checkout set packages/openpi-client
  git -C third_party/openpi checkout --detach 15a9616a00943ada6c20a0f158e3adb39df2ccac
fi
checkout https://github.com/Physical-Intelligence/openpi.git third_party/openpi 15a9616a00943ada6c20a0f158e3adb39df2ccac

uv venv --python 3.11 --allow-existing .venv
uv pip install --python .venv/bin/python -e '.[sim,test]' \
  -e third_party/LIBERO-PRO -e third_party/openpi/packages/openpi-client
echo 'Ready. Run .venv/bin/python -m pytest -q, then see README.md.'
