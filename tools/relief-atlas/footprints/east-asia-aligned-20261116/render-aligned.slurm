#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=00:30:00
#SBATCH --job-name=east-asia-aligned
#SBATCH --output=logs/render-%j.out
set -euo pipefail
cd "$SLURM_SUBMIT_DIR"
export OMP_NUM_THREADS=8
export OPENBLAS_NUM_THREADS=8
/data/run01/scwb515/toolchains/blender-4.5.3-linux-x64/blender --background --threads 8 --python-exit-code 1 --python render-footprint-atlas.py -- --root overview --reference-root . --style style.json --map east_asia --variants colour --save-scene
