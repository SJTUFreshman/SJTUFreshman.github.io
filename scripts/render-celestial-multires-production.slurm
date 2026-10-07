#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=24:00:00
#SBATCH --array=0-39%8
#SBATCH --job-name=celestial-multires-v5
#SBATCH --output=logs/multires-v5-%A_%a.out
set -euo pipefail
: "${ATLAS_ROOT:?Set ATLAS_ROOT to the staged job directory under ~/run}"
: "${BLENDER_BIN:?Set BLENDER_BIN to the Blender executable}"
cd "$ATLAS_ROOT"
bodies=(earth sun mercury venus moon mars jupiter saturn uranus neptune)
task_index=${SLURM_ARRAY_TASK_ID:-0}
body=${BODY:-${bodies[$((task_index % 10))]}}
shard_count=${SHARD_COUNT:-4}
shard_index=${SHARD_INDEX:-$((task_index / 10))}
output_root=${OUTPUT_ROOT:-$ATLAS_ROOT/baked-multires-v5/master}
scene_root=${SCENE_ROOT:-$ATLAS_ROOT/scenes-multires-v5}
frames=${FRAMES:-all}
samples=${SAMPLES:-128}
"$BLENDER_BIN" -b -t 8 --disable-autoexec --python-exit-code 1 --python "$ATLAS_ROOT/render-celestial-model-multires-v5.py" -- \
    --models "$ATLAS_ROOT/user-models" --body "$body" --output "$output_root" \
    --width 8192 --height 8192 --samples "$samples" --azimuth-count 180 \
    --elevations=-90,-60,-30,0,30,60,90 --frames "$frames" \
    --shard-count "$shard_count" --shard-index "$shard_index" \
    --framing full-sphere --frame-margin 0.06 --layers split --independent-ring-framing \
    --format WEBP --quality 96 --tier 8k --device OPTIX --threads 8 --halo 0.3 \
    --light-azimuth 90 --light-elevation 35 --cloud-relief 1.4 --resume \
    --blend "$scene_root/$body-shard$shard_index.blend"
