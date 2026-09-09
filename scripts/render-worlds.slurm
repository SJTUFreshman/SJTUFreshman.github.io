#!/bin/bash
#SBATCH --job-name=life-panorama
#SBATCH --gpus=1
#SBATCH --time=01:00:00
#SBATCH --output=/data/home/scwb515/run/yangrunde/life_worlds/logs/%j.out
#SBATCH --error=/data/home/scwb515/run/yangrunde/life_worlds/logs/%j.err
set -euo pipefail
cd /data/home/scwb515/run/yangrunde/life_worlds
export XDG_CACHE_HOME=/data/home/scwb515/run/yangrunde/life_worlds/cache
blender_bin=/data/home/scwb515/run/yangrunde/life_worlds/tools/blender-4.5.3-linux-x64/blender
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
"$blender_bin" -b --python-exit-code 1 --python scripts/render-world-panorama.py -- --scene .render-work/scenes/spaceship.scene.json --asset-root . --output renders/spaceship-r2.png --blend renders/spaceship-r2.blend --width 2048 --height 1024 --samples 64 --device CUDA
