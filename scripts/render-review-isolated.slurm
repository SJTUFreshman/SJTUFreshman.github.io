#!/bin/bash
#SBATCH -p hp_a800
#SBATCH --gpus=1
#SBATCH --nodes=1
#SBATCH --time=02:00:00
#SBATCH --job-name=life-visual-review
set -euo pipefail
RENDER_ROOT=/data/home/scwb515/run/yangrunde/life_worlds
REVIEW_ROOT="${1:?Supply the isolated review directory}"
if [[ -z "${SLURM_JOB_ID:-}" ]]; then
  echo "Submit this script with sbatch." >&2
  exit 1
fi
cd "$REVIEW_ROOT"
export XDG_CACHE_HOME="$RENDER_ROOT/cache"
export CUDA_CACHE_PATH="$RENDER_ROOT/cache/cuda"
export PYTHONUNBUFFERED=1
mkdir -p "$XDG_CACHE_HOME" "$CUDA_CACHE_PATH"
printf 'REVIEW_JOB %s\nREVIEW_ROOT %s\n' "$SLURM_JOB_ID" "$PWD"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
sha256sum scripts/*.py queue.json > source-sha256.txt
if [[ -f native-queue.json ]]; then
  sha256sum native-queue.json >> source-sha256.txt
fi
python3 scripts/validate-render-inputs.py --queue queue.json
"$RENDER_ROOT/tools/blender-4.5.3-linux-x64/blender" -b --python-exit-code 1 \
  --python scripts/render-review-batch.py -- --queue queue.json
if [[ -f native-queue.json ]]; then
  "$RENDER_ROOT/tools/blender-4.5.3-linux-x64/blender" -b --python-exit-code 1 \
    --python scripts/render-review-views.py -- --queue native-queue.json
fi
