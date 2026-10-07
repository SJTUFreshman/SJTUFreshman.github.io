#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=24:00:00
# Eight climate frames × two bodies × four azimuth shards.
# Override --array when changing CLIMATE_FRAMES, CLIMATE_BODIES, or SHARD_COUNT.
#SBATCH --array=0-63%8
#SBATCH --job-name=celestial-climate-v6
#SBATCH --output=logs/climate-v6-%A_%a.out
set -euo pipefail

: "${ATLAS_ROOT:?Set ATLAS_ROOT to the staged job directory under ~/run}"
: "${BLENDER_BIN:?Set BLENDER_BIN to the Blender executable}"
cd "$ATLAS_ROOT"
IFS=',' read -r -a bodies <<< "${CLIMATE_BODIES:-earth,mars}"
task_index=${SLURM_ARRAY_TASK_ID:-0}
shard_count=${SHARD_COUNT:-4}
body_count=${#bodies[@]}
tasks_per_time=$((body_count * shard_count))
if [[ -n "${CLIMATE_TIME:-}" ]]; then
    climate_time=$CLIMATE_TIME
    local_index=$task_index
else
    climate_time=$((task_index / tasks_per_time))
    local_index=$((task_index % tasks_per_time))
fi
body=${BODY:-${bodies[$((local_index % body_count))]}}
shard_index=${SHARD_INDEX:-$((local_index / body_count))}
climate_frames=${CLIMATE_FRAMES:-8}
if (( climate_time < 0 || climate_time >= climate_frames || shard_index >= shard_count )); then
    exit 0
fi
job_root=${CLIMATE_JOB_ROOT:-$ATLAS_ROOT/climate-v6-production}
output_root=${OUTPUT_ROOT:-$job_root/baked/master}
scene_root=${SCENE_ROOT:-$job_root/scenes}
climate_root=${CLIMATE_ROOT:-$ATLAS_ROOT/climate-v6/maps}
renderer=${RENDERER:-$ATLAS_ROOT/render-celestial-model.py}
texture="$climate_root/$body/t$(printf '%03d' "$climate_time").png"
test -f "$texture"

"$BLENDER_BIN" -b -t 8 --disable-autoexec --python-exit-code 1 --python "$renderer" -- \
    --models "$ATLAS_ROOT/user-models" --body "$body" --output "$output_root" \
    --width "${CLIMATE_WIDTH:-2048}" --height "${CLIMATE_HEIGHT:-2048}" \
    --samples "${CLIMATE_SAMPLES:-64}" --azimuth-count "${CLIMATE_AZIMUTH_COUNT:-180}" \
    --elevations="${CLIMATE_ELEVATIONS:--90,-60,-30,0,30,60,90}" --frames "${CLIMATE_VIEW_FRAMES:-all}" \
    --shard-count "$shard_count" --shard-index "$shard_index" \
    --framing full-sphere --frame-margin 0.06 --layers split --cloud-only \
    --format WEBP --quality "${CLIMATE_QUALITY:-92}" --tier "${CLIMATE_TIER:-2k}" --device OPTIX --threads 8 --halo 0.3 \
    --light-azimuth 90 --light-elevation 35 --cloud-relief 1.4 \
    --cloud-texture "$texture" --climate-time "$climate_time" \
    --climate-model moisture-lifecycle-v2.1 --climate-frame-count "$climate_frames" \
    --climate-step-hours "${CLIMATE_STEP_HOURS:-3}" --climate-time-pad "${CLIMATE_TIME_PAD:-3}" --resume \
    --blend "$scene_root/$body-climate$climate_time-shard$shard_index.blend"
