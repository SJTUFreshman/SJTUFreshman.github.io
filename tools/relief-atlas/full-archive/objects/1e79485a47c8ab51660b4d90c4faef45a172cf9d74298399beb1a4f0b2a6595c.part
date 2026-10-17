#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=00:20:00
#SBATCH --job-name=footprint-regions
#SBATCH --output=logs/render-%j.out
set -euo pipefail
cd "$HOME/run/yangrunde/footprints-administrative-20261016"
export OMP_NUM_THREADS=8
export OPENBLAS_NUM_THREADS=8
for identifier in east_asia europe_usa; do
    "$HOME/run/toolchains/blender-4.5.3-linux-x64/blender" --background --threads 8 --python-exit-code 1 --python render-footprint-atlas.py -- --root "$PWD" --reference-root "$PWD" --style footprints-style.json --map "$identifier" --variants colour --save-scene
done
