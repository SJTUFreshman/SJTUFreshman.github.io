#!/bin/bash
#SBATCH -p hp_a800
#SBATCH --gpus=1
#SBATCH --time=00:30:00
#SBATCH --job-name=life-day-skies
#SBATCH --output=/data/home/scwb515/run/yangrunde/life_worlds/logs/day-skies-%j.out
#SBATCH --error=/data/home/scwb515/run/yangrunde/life_worlds/logs/day-skies-%j.err
set -euo pipefail

RENDER_ROOT=/data/home/scwb515/run/yangrunde/life_worlds
BLENDER="$RENDER_ROOT/tools/blender-4.5.3-linux-x64/blender"
OUTPUT_DIR="$RENDER_ROOT/rendered-skies"
mkdir -p "$OUTPUT_DIR"

"$BLENDER" -b --python "$RENDER_ROOT/scripts/render-day-sky.py" -- \
  --scene hogwarts --mode clear --device CUDA --width 2048 --samples 128 \
  --sun-direction -0.011084127587258408 0.899527220568828 -0.4367240794498839 \
  --output "$OUTPUT_DIR/sky-clear-test.png" --blend "$OUTPUT_DIR/sky-clear-test.blend"

"$BLENDER" -b --python "$RENDER_ROOT/scripts/render-day-sky.py" -- \
  --scene hogwarts --mode dusk --device CUDA --width 2048 --samples 128 \
  --sun-direction -0.9950992292926164 0.023776122023868508 0.09598030987003012 \
  --output "$OUTPUT_DIR/sky-dusk-test.png" --blend "$OUTPUT_DIR/sky-dusk-test.blend"
