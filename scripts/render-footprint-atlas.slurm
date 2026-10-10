#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=00:30:00
#SBATCH --job-name=footprint-atlas
#SBATCH --output=logs/render-%j.out
set -euo pipefail
REPO_ROOT=${REPO_ROOT:-$SLURM_SUBMIT_DIR}
ATLAS_WORK=${ATLAS_WORK:-$REPO_ROOT/.render-work/footprints}
REFERENCE_ROOT=${REFERENCE_ROOT:-$REPO_ROOT/tools/relief-atlas/reference}
BLENDER_BIN=${BLENDER_BIN:-blender}
RENDER_SCRIPT=${RENDER_SCRIPT:-$REPO_ROOT/scripts/render-footprint-atlas.py}
cd "$ATLAS_WORK"
export OMP_NUM_THREADS=8
export OPENBLAS_NUM_THREADS=8
scene_args=()
if [ "${ATLAS_SCENE_ONLY:-0}" = 1 ]; then
    scene_args+=(--scene-only)
fi
if [ "$#" -eq 0 ]; then
    set -- china east_asia europe_usa
fi
for identifier in "$@"; do
    "$BLENDER_BIN" --background --threads 8 --python-exit-code 1 --python "$RENDER_SCRIPT" -- --root "$ATLAS_WORK" --reference-root "$REFERENCE_ROOT" --map "$identifier" "${scene_args[@]}"
done
