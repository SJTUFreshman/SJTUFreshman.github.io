#!/bin/bash
#SBATCH --partition=hp_a800
#SBATCH --gpus=1
#SBATCH --time=1-00:00:00
#SBATCH --job-name=celestial-release-prepare
#SBATCH --output=logs/climate-release-%A.out
set -euo pipefail

: "${ATLAS_ROOT:?Set ATLAS_ROOT to the staged job directory under ~/run}"
: "${CELESTIAL_RELEASE_VERSION:?Set a new immutable release version}"
cd "$ATLAS_ROOT"

python_bin=${PYTHON_BIN:-/data/apps/miniforge3/25.11.0-1/bin/python}
script_root=${CELESTIAL_SCRIPT_ROOT:-$ATLAS_ROOT}
source_root=${CLIMATE_ASSEMBLY_ROOT:-$ATLAS_ROOT/climate-v6-production/assembled}
release_root=${CELESTIAL_RELEASE_ROOT:-$ATLAS_ROOT/climate-v6-production/releases/$CELESTIAL_RELEASE_VERSION}
test -f "$source_root/manifest.json"
test -f "$source_root/SHA256SUMS"
mkdir -p "$release_root"
exec 9>"$release_root/.prepare.lock"
flock -n 9
"$python_bin" -u "$script_root/manage-celestial-release.py" prepare \
    --input "$source_root" --output "$release_root" --version "$CELESTIAL_RELEASE_VERSION"
echo "CLIMATE_RELEASE_READY $release_root"
