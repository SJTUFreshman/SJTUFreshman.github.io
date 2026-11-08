#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=00:45:00
#SBATCH --job-name=footprint-sectional
#SBATCH --output=logs/render-%j.out
set -euo pipefail
ATLAS_ARCHIVE=${ATLAS_ARCHIVE:-$SLURM_SUBMIT_DIR}
BLENDER_BIN=${BLENDER_BIN:-/data/run01/scwb515/toolchains/blender-4.5.3-linux-x64/blender}
export OMP_NUM_THREADS=8
export OPENBLAS_NUM_THREADS=8
cd "$ATLAS_ARCHIVE"
render_map() {
    local layer=$1
    local identifier=$2
    shift 2
    "$BLENDER_BIN" --background --threads 8 --python-exit-code 1 --python "$ATLAS_ARCHIVE/render-footprint-atlas.py" -- \
        --root "$ATLAS_ARCHIVE/$layer" --reference-root "$ATLAS_ARCHIVE" --style "$ATLAS_ARCHIVE/style.json" \
        --map "$identifier" --variants "$@" --save-scene
}
if [ "${1:-main}" = insets ]; then
    render_map detail singapore relief
    render_map detail hawaii relief
elif [ "${1:-main}" = cultural ]; then
    render_map cultural china colour
elif [ "${1:-main}" = east-asia-cultural ]; then
    render_map overview east_asia colour
else
    render_map detail china relief colour
    render_map detail east_asia relief colour
    render_map detail europe_usa relief
    render_map overview east_asia colour
    render_map overview europe_usa colour
fi
