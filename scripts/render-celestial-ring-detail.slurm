#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=02:00:00
#SBATCH --array=0-1%1
#SBATCH --job-name=celestial-ring-detail
#SBATCH --output=logs/ring-detail-%A_%a.out
set -euo pipefail
: "${ATLAS_ROOT:?Set ATLAS_ROOT to the staged job directory under ~/run}"
: "${BLENDER_BIN:?Set BLENDER_BIN to the Blender executable}"
cd "$ATLAS_ROOT"
bodies=(saturn uranus)
body=${BODY:-${bodies[$((SLURM_ARRAY_TASK_ID % 2))]}}
shard_count=${SHARD_COUNT:-1}
shard_index=${SHARD_INDEX:-$((SLURM_ARRAY_TASK_ID / 2))}
output_root=${OUTPUT_ROOT:-$ATLAS_ROOT/baked-ring-detail-review}
scene_root=${SCENE_ROOT:-$ATLAS_ROOT/scenes-ring-detail-review}
frames=${FRAMES:-4:0}
width=${WIDTH:-4096}
height=${HEIGHT:-4096}
quality=${QUALITY:-94}
tier=${TIER:-auto}
"$BLENDER_BIN" -b -t 12 --disable-autoexec --python-exit-code 1 --python "$ATLAS_ROOT/render-celestial-model-ring-detail.py" -- \
    --models "$ATLAS_ROOT/user-models" --body "$body" --output "$output_root" \
    --width "$width" --height "$height" --samples 64 --azimuth-count 180 \
    --elevations=-90,-60,-30,0,30,60,90 --frames "$frames" \
    --shard-count "$shard_count" --shard-index "$shard_index" \
    --framing full-sphere --frame-margin 0.06 --layers split --independent-ring-framing \
    --format WEBP --quality "$quality" --tier "$tier" --device OPTIX --halo 0.3 \
    --light-azimuth 90 --light-elevation 35 --cloud-relief 1.4 --resume \
    --blend "$scene_root/$body-shard$shard_index.blend"
