#!/bin/bash
#SBATCH -p hp_a800
#SBATCH --gpus=1
#SBATCH --nodes=1
#SBATCH --time=02:00:00
#SBATCH --job-name=life-snow-review
#SBATCH --output=/data/home/scwb515/run/yangrunde/life_worlds/logs/snow-review-%j.out
#SBATCH --error=/data/home/scwb515/run/yangrunde/life_worlds/logs/snow-review-%j.err
set -euo pipefail
ROOT=/data/home/scwb515/run/yangrunde/life_worlds
cd "$ROOT"
BLENDER="$ROOT/tools/blender-4.5.3-linux-x64/blender"
python3 scripts/validate-render-inputs.py --queue .render-work/review-snow-r14.json
"$BLENDER" -b --python-exit-code 1 --python scripts/render-review-batch.py -- --queue .render-work/review-snow-r14.json
