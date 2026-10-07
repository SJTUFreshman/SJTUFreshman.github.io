#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=12:00:00
#SBATCH --array=0-9%4
#SBATCH --job-name=celestial-multires-package
#SBATCH --output=logs/multires-package-%A_%a.out
set -euo pipefail

: "${ATLAS_ROOT:?Set ATLAS_ROOT to the staged job directory under ~/run}"
cd "$ATLAS_ROOT"
bodies=(earth sun mercury venus moon mars jupiter saturn uranus neptune)
export BODY=${BODY:-${bodies[$SLURM_ARRAY_TASK_ID]}}
exec bash "$ATLAS_ROOT/package-celestial-multires.slurm"
