#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=02:00:00
#SBATCH --array=0-9%4
#SBATCH --job-name=celestial-sphere-package
#SBATCH --output=logs/full-sphere-package-%A_%a.out
set -euo pipefail
: "${ATLAS_ROOT:?Set ATLAS_ROOT to the staged job directory under ~/run}"
cd "$ATLAS_ROOT"
bodies=(earth sun mercury venus moon mars jupiter saturn uranus neptune)
body=${bodies[$SLURM_ARRAY_TASK_ID]}
output_root=${OUTPUT_ROOT:-$ATLAS_ROOT/baked-full-sphere-v4}
archive_root=${ARCHIVE_ROOT:-$ATLAS_ROOT/delivery-full-sphere-v4}
python_bin=${PYTHON_BIN:-/data/apps/miniforge3/25.11.0-1/bin/python}
"$python_bin" "$ATLAS_ROOT/package-celestial-atlas.py" \
    --input "$output_root" --output "$output_root" --body "$body" \
    --input-format webp --workers 8 --width 4096 --height 4096 \
    --azimuth-count 180 --elevations=-90,-60,-30,0,30,60,90
mkdir -p "$archive_root"
tar -cf "$archive_root/$body.tar.partial" -C "$output_root" "$body"
mv "$archive_root/$body.tar.partial" "$archive_root/$body.tar"
