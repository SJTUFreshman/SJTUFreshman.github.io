#!/bin/bash
#SBATCH -p hp_a800
#SBATCH --gpus=1
#SBATCH --nodes=1
#SBATCH --time=04:00:00
#SBATCH --job-name=life-review-next
#SBATCH --output=/data/home/scwb515/run/yangrunde/life_worlds/logs/review-next-%j.out
#SBATCH --error=/data/home/scwb515/run/yangrunde/life_worlds/logs/review-next-%j.err
set -euo pipefail
ROOT=/data/home/scwb515/run/yangrunde/life_worlds
cd "$ROOT"
BLENDER="$ROOT/tools/blender-4.5.3-linux-x64/blender"
export XDG_CACHE_HOME="$ROOT/cache"
export CUDA_CACHE_PATH="$ROOT/cache/cuda"
mkdir -p "$XDG_CACHE_HOME" "$CUDA_CACHE_PATH"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
python3 scripts/validate-render-inputs.py \
  --queue .render-work/review-hogwarts-r14.json \
  --queue .render-work/review-snow-r11.json
"$BLENDER" -b --python-exit-code 1 --python scripts/render-review-batch.py -- --queue .render-work/review-hogwarts-r14.json
"$BLENDER" -b --python-exit-code 1 --python scripts/render-review-batch.py -- --queue .render-work/review-snow-r11.json
