#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=12:00:00
#SBATCH --job-name=celestial-climate-publish
#SBATCH --output=logs/climate-publish-%A.out
set -euo pipefail

: "${ATLAS_ROOT:?Set ATLAS_ROOT to the staged job directory under ~/run}"
cd "$ATLAS_ROOT"

python_bin=${PYTHON_BIN:-/data/apps/miniforge3/25.11.0-1/bin/python}
output=${CLIMATE_ASSEMBLY_ROOT:-$ATLAS_ROOT/climate-v6-production/assembled}
script_root=${CELESTIAL_SCRIPT_ROOT:-$ATLAS_ROOT}
assembler=${CLIMATE_ASSEMBLER:-$script_root/assemble-celestial-climate.py}
args=(publish --output "$output" --workers "${CLIMATE_PUBLISH_WORKERS:-4}")
if [[ -n "${CLIMATE_FRAME_BASE_URL:-}" ]]; then
    args+=(--frame-base-url "$CLIMATE_FRAME_BASE_URL")
fi
if [[ -n "${CLIMATE_HOSTED_OUTPUT:-}" ]]; then
    args+=(--hosted-output "$CLIMATE_HOSTED_OUTPUT")
fi

test -f "$assembler"
test -f "$output/climate-assembly.json"
exec 9>"$output/.publish.lock"
flock -n 9
"$python_bin" -u "$assembler" "${args[@]}"
echo "CLIMATE_PUBLISH_DONE $output"
