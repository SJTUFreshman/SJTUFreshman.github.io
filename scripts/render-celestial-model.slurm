#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=06:00:00
#SBATCH --array=0-19%8
#SBATCH --job-name=celestial-4k
#SBATCH --output=logs/bake-%A_%a.out
set -euo pipefail
: "${ATLAS_ROOT:?Set ATLAS_ROOT to the staged job directory under ~/run}"
: "${BLENDER_BIN:?Set BLENDER_BIN to the Blender executable}"
cd "$ATLAS_ROOT"
bodies=(earth sun mercury venus moon mars jupiter saturn uranus neptune)
body=${bodies[$((SLURM_ARRAY_TASK_ID % 10))]}
shard=$((SLURM_ARRAY_TASK_ID / 10))
"$BLENDER_BIN" -b -t 12 --disable-autoexec --python-exit-code 1 --python "$ATLAS_ROOT/render-celestial-model.py" -- \
    --models "$ATLAS_ROOT/user-models" --body "$body" --output "$ATLAS_ROOT/baked-4k-v2" \
    --width 3840 --height 2160 --samples 64 --azimuth-count 180 \
    --elevations=-90,-60,-30,0,30,60,90 --frames all --shard-count 2 --shard-index "$shard" \
    --format WEBP --quality 90 --device OPTIX --halo 0.3 \
    --light-azimuth 90 --light-elevation 35 --cloud-relief 1.4 --resume \
    --blend "$ATLAS_ROOT/scenes-4k-v2/$body-shard$shard.blend"
