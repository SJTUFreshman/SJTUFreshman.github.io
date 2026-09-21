#!/bin/bash
#SBATCH -p hp_a800
#SBATCH --gpus=1
#SBATCH --nodes=1
#SBATCH --time=02:00:00
#SBATCH --job-name=life-highpoly
#SBATCH --output=/data/home/scwb515/run/yangrunde/life_worlds/logs/highpoly-%j.out
#SBATCH --error=/data/home/scwb515/run/yangrunde/life_worlds/logs/highpoly-%j.err
set -euo pipefail
RENDER_ROOT=/data/home/scwb515/run/yangrunde/life_worlds
cd "$RENDER_ROOT"
export XDG_CACHE_HOME="$RENDER_ROOT/cache"
export CUDA_CACHE_PATH="$RENDER_ROOT/cache/cuda"
export CUDA_CACHE_MAXSIZE=2147483648
BLENDER="$RENDER_ROOT/tools/blender-4.5.3-linux-x64/blender"
required_inputs=(
  "$BLENDER"
  scripts/render-review-batch.py scripts/render-world-panorama.py
  scripts/refine-cockpit.py scripts/refine-wasteland.py scripts/refine-city-details.py
  scripts/refine-flight-displays.py
  scripts/refine-shelter.py scripts/refine-landscapes.py
  assets/life/textures/fabric_pattern_07_col_03_1k.jpg
  assets/life/textures/fabric_pattern_07_col_1_1k.jpg
  assets/life/textures/fabric_pattern_07_nor_gl_1k.jpg
  assets/life/textures/fabric_pattern_07_rough_1k.jpg
)
for material in wood_floor brushed_concrete; do
  for channel in diff nor_gl rough; do
    required_inputs+=("assets/life/textures/${material}_${channel}_1k.jpg")
  done
done
for material in asphalt_03 old_stone_wall painted_metal_shutter; do
  for channel in diff nor rough; do
    required_inputs+=("assets/life/textures/library/$material/${material}_${channel}_2k.jpg")
  done
done
preflight_args=(--queue .render-work/review-ship-r13.json --queue .render-work/review-city-r8.json)
for required_input in "${required_inputs[@]}"; do
  preflight_args+=(--required-file "$required_input")
done
python3 scripts/validate-render-inputs.py "${preflight_args[@]}"
if [[ "${1:-}" == "--check-inputs" ]]; then
  exit 0
fi
if [[ -z "${SLURM_JOB_ID:-}" ]]; then
  echo "Rendering requires a Slurm allocation; use --check-inputs for a file-only check." >&2
  exit 1
fi
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
"$BLENDER" -b --python-exit-code 1 --python scripts/render-review-batch.py -- --queue .render-work/review-ship-r13.json
"$BLENDER" -b --python-exit-code 1 --python scripts/render-review-batch.py -- --queue .render-work/review-city-r8.json
