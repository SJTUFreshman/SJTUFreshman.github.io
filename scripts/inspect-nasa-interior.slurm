#!/bin/bash
#SBATCH -p hp_a800
#SBATCH --gpus=1
#SBATCH --time=00:25:00
#SBATCH --job-name=life-nasa-inspect
set -euo pipefail
: "${SLURM_JOB_ID:?NASA inspection requires a Slurm allocation}"
test "${SLURM_JOB_PARTITION:-}" = hp_a800
ROOT=/data/home/scwb515/run/yangrunde/life_worlds
RUN_DIR="${1:?Supply an isolated absolute NASA run directory}"
case "$RUN_DIR" in
    "$ROOT"/.render-work/nasa-*) ;;
    *) printf '%s\n' 'Run directory must be an isolated NASA directory under life_worlds/.render-work' >&2; exit 2 ;;
esac
test -d "$RUN_DIR"
test -s "$RUN_DIR/inspect-nasa-interior.py"
cd "$RUN_DIR"
FBX="$ROOT/.render-work/public-models/nasa/International Space Station (ISS) [internal].fbx"
test -s "$FBX"
printf '%s  %s\n' bb884b3f5fdae3fe6116bd2241b44e8efb2f804de8785840431f400ebfa09816 "$FBX" | sha256sum -c -
nvidia-smi --query-gpu=name,uuid --format=csv
"$ROOT/tools/blender-4.5.3-linux-x64/blender" -b --python-exit-code 1 --python "$RUN_DIR/inspect-nasa-interior.py" -- \
    --fbx "$FBX" --output "$RUN_DIR/inspection.json" --save-blend "$RUN_DIR/nasa-iss-inspected.blend" "${@:2}"
test -s "$RUN_DIR/inspection.json"
test -s "$RUN_DIR/nasa-iss-inspected.blend"
printf '%s\n' "NASA_INSPECTION_COMPLETE job=$SLURM_JOB_ID directory=$RUN_DIR"
