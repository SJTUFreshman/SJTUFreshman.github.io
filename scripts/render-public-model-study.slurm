#!/bin/bash
#SBATCH -p hp_a800
#SBATCH --gpus=1
#SBATCH --nodes=1
#SBATCH --time=00:40:00
#SBATCH --job-name=life-public-model-study
set -euo pipefail
RENDER_ROOT=/data/home/scwb515/run/yangrunde/life_worlds
STUDY_ROOT="${1:?Supply the isolated study directory}"
if [[ -z "${SLURM_JOB_ID:-}" ]]; then
  echo "Submit this script with sbatch." >&2
  exit 1
fi
cd "$STUDY_ROOT"
export XDG_CACHE_HOME="$RENDER_ROOT/cache"
export CUDA_CACHE_PATH="$RENDER_ROOT/cache/cuda"
export PYTHONUNBUFFERED=1
printf 'PUBLIC_STUDY_JOB %s\nSTUDY_ROOT %s\n' "$SLURM_JOB_ID" "$PWD"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
sha256sum scripts/*.py queue.json > source-sha256.txt
"$RENDER_ROOT/tools/blender-4.5.3-linux-x64/blender" -b --python-exit-code 1 \
  --python scripts/render-public-model-study.py -- --queue queue.json
