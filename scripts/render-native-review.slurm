#!/bin/bash
#SBATCH -p hp_a800
#SBATCH --gpus=1
#SBATCH --nodes=1
#SBATCH --time=01:00:00
#SBATCH --job-name=life-native-review
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
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
"$RENDER_ROOT/tools/blender-4.5.3-linux-x64/blender" -b --python-exit-code 1 \
  --python scripts/render-review-views.py -- --queue native-queue.json
