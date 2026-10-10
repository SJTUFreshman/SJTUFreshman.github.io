#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=12:00:00
#SBATCH --job-name=celestial-multires-package
#SBATCH --output=logs/multires-package-%A_%a.out
set -euo pipefail

: "${ATLAS_ROOT:?Set ATLAS_ROOT to the staged job directory under ~/run}"
: "${BODY:?Set BODY to exactly one completed celestial body}"
cd "$ATLAS_ROOT"

case "$BODY" in
    sun|mercury|venus|earth|moon|mars|jupiter|saturn|uranus|neptune) ;;
    *) echo "Unsupported BODY=$BODY" >&2; exit 2 ;;
esac

python_bin=${PYTHON_BIN:-/data/apps/miniforge3/25.11.0-1/bin/python}
output_root=${OUTPUT_ROOT:-$ATLAS_ROOT/baked-multires-v5/master}
script_root=${CELESTIAL_SCRIPT_ROOT:-$ATLAS_ROOT}
resume_args=()
if [[ "${PACKAGE_RESUME:-0}" == 1 ]]; then
    resume_args+=(--resume-derivatives)
fi
if [[ "${PACKAGE_ADOPT_EXISTING:-0}" == 1 ]]; then
    resume_args+=(--adopt-existing-derivatives)
fi
exec 9>"$output_root/$BODY/.package.lock"
flock -n 9

"$python_bin" -u "$script_root/package-celestial-atlas.py" \
    --input "$output_root" --output "$output_root" --body "$BODY" \
    --input-format webp --workers "${PACKAGE_WORKERS:-1}" --width 8192 --height 8192 \
    --resolution-widths 2048,4096 \
    --azimuth-count 180 --elevations=-90,-60,-30,0,30,60,90 "${resume_args[@]}"
