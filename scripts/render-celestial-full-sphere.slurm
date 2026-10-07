#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=02:00:00
#SBATCH --array=0-9%4
#SBATCH --job-name=celestial-sphere
#SBATCH --output=logs/full-sphere-%j.out
set -euo pipefail
: "${ATLAS_ROOT:?Set ATLAS_ROOT to the staged job directory under ~/run}"
: "${BLENDER_BIN:?Set BLENDER_BIN to the Blender executable}"
cd "$ATLAS_ROOT"
bodies=(earth sun mercury venus moon mars jupiter saturn uranus neptune)
body=${BODY:-${bodies[${SLURM_ARRAY_TASK_ID:-0}]}}
default_frames=3:0
if [[ "$body" == earth ]]; then default_frames=3:0-2; fi
if [[ "$body" == saturn || "$body" == uranus ]]; then default_frames=4:0; fi
frames=${FRAMES:-$default_frames}
azimuth_count=${AZIMUTH_COUNT:-180}
samples=${SAMPLES:-64}
output_root=${OUTPUT_ROOT:-$ATLAS_ROOT/baked-full-sphere-v4-review}
scene_root=${SCENE_ROOT:-$ATLAS_ROOT/scenes-full-sphere-v4-review}
"$BLENDER_BIN" -b -t 12 --disable-autoexec --python-exit-code 1 --python "$ATLAS_ROOT/render-celestial-model.py" -- \
    --models "$ATLAS_ROOT/user-models" --body "$body" --output "$output_root" \
    --width 4096 --height 4096 --samples "$samples" --azimuth-count "$azimuth_count" \
    --elevations=-90,-60,-30,0,30,60,90 --frames "$frames" \
    --framing full-sphere --frame-margin 0.06 --layers split \
    --format WEBP --quality 94 --device OPTIX --halo 0.3 \
    --light-azimuth 90 --light-elevation 35 --cloud-relief 1.4 --resume \
    --blend "$scene_root/$body.blend"
