#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=00:15:00
#SBATCH --job-name=relief-light-preview
#SBATCH --output=logs/light-preview-%j.out
set -euo pipefail
ROOT=/data/home/scwb515/run/yangrunde/relief-atlas-20261008
BLENDER=/data/home/scwb515/run/yangrunde/life_worlds/tools/blender-4.5.3-linux-x64/blender
cd "$ROOT"
export OMP_NUM_THREADS=8
export OPENBLAS_NUM_THREADS=8
"$BLENDER" --background --threads 8 --python-exit-code 1 --python "$ROOT/preview_lighting.py" -- --root "$ROOT" "$@"
