#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=1-00:00:00
#SBATCH --job-name=celestial-climate-v6
#SBATCH --output=logs/climate-package-%A.out
set -euo pipefail

: "${ATLAS_ROOT:?Set ATLAS_ROOT to the staged job directory under ~/run}"
cd "$ATLAS_ROOT"

python_bin=${PYTHON_BIN:-/data/apps/miniforge3/25.11.0-1/bin/python}
master=${CLIMATE_MASTER:-$ATLAS_ROOT/baked-multires-v5/master}
climate=${CLIMATE_RENDER_ROOT:-$ATLAS_ROOT/climate-v6-production/baked/master}
output=${CLIMATE_ASSEMBLY_ROOT:-$ATLAS_ROOT/climate-v6-production/assembled}
script_root=${CELESTIAL_SCRIPT_ROOT:-$ATLAS_ROOT}
assembler=${CLIMATE_ASSEMBLER:-$script_root/assemble-celestial-climate.py}
stage=${CLIMATE_PACKAGE_STAGE:-all}
case "$stage" in
    assemble|package|all) ;;
    *) echo "Unsupported CLIMATE_PACKAGE_STAGE=$stage" >&2; exit 2 ;;
esac

test -f "$assembler"
if [[ "$stage" != package ]]; then
    exec 8>"$climate/.assembly.lock"
    flock -n 8
    test -f "$master/earth/package.json"
    test -f "$master/mars/package.json"
    if [[ -e "$output" && ! -f "$output/climate-assembly.json" ]]; then
        echo "Assembly output exists without a completion manifest: $output" >&2
        exit 2
    fi
    if [[ ! -f "$output/climate-assembly.json" ]]; then
        "$python_bin" -u "$assembler" assemble --master "$master" --climate "$climate" --output "$output" \
            --frame-count "${CLIMATE_FRAMES:-8}" --resolution-widths "${CLIMATE_RESOLUTION_WIDTHS:-2048,4096}"
    fi
    echo "CLIMATE_ASSEMBLY_DONE $output"
    flock -u 8
fi
if [[ "$stage" == assemble ]]; then exit 0; fi

bodies=(earth mars)
if [[ "$stage" == package ]]; then
    case "${BODY:-}" in
        earth|mars) bodies=("$BODY") ;;
        *) echo "BODY must be earth or mars for the package stage" >&2; exit 2 ;;
    esac
fi
test -f "$output/climate-assembly.json"
for body in "${bodies[@]}"; do
    exec 9>"$output/$body/.package.lock"
    flock -n 9
    "$python_bin" -u "$assembler" package --output "$output" --body "$body" \
        --workers "${CLIMATE_PACKAGE_WORKERS:-4}" --resume-derivatives
    flock -u 9
done

echo "CLIMATE_PACKAGE_DONE $output"
