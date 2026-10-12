#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=00:15:00
#SBATCH --job-name=footprint-sea-study
#SBATCH --output=logs/sea-study-%j.out
set -euo pipefail
cd "$SLURM_SUBMIT_DIR"
export OMP_NUM_THREADS=8
export OPENBLAS_NUM_THREADS=8
for sea in '#7595a6' '#8ca6b5' '#9eb5c0'; do
    "$HOME/run/toolchains/blender-4.5.3-linux-x64/blender" --background --threads 8 --python-exit-code 1 --python render-footprint-atlas.py -- --root . --reference-root . --style footprints-style.json --map china --preview --sea-colour "$sea"
done
