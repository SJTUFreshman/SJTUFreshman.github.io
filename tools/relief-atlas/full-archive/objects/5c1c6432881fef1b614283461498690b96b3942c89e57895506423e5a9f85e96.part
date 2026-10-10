#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=00:45:00
#SBATCH --job-name=relief-atlas
#SBATCH --output=logs/relief-%j.out
set -euo pipefail
ROOT=/data/home/scwb515/run/yangrunde/relief-atlas-20261008
BLENDER=/data/home/scwb515/run/yangrunde/life_worlds/tools/blender-4.5.3-linux-x64/blender
cd "$ROOT"
export OMP_NUM_THREADS=8
export OPENBLAS_NUM_THREADS=8
if [[ "${1:?map required}" == "all" ]]; then
    for map in hainan shengsi china fujian_taiwan; do
        "$BLENDER" --background --threads 8 --python-exit-code 1 --python "$ROOT/render_atlas.py" -- --root "$ROOT" --map "$map"
    done
else
    "$BLENDER" --background --threads 8 --python-exit-code 1 --python "$ROOT/render_atlas.py" -- --root "$ROOT" --map "$1" "${@:2}"
fi
