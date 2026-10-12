#!/bin/bash
set -euo pipefail
cd "$HOME/run/toolchains"
if ! test -x blender-4.5.3-linux-x64/blender; then
    curl --fail --location --silent --show-error --retry 3 --output blender-4.5.3-linux-x64.tar.xz https://mirrors.aliyun.com/blender/release/Blender4.5/blender-4.5.3-linux-x64.tar.xz
    # SHA-256 来自 Blender 官方发布清单，下载镜像不能改变所用的程序版本或字节。
    sha256sum --check <<'SHA256'
975c58fcb244273838534bba771e64ad87739216b0f9b39a888531a49a72d845  blender-4.5.3-linux-x64.tar.xz
SHA256
    tar -xf blender-4.5.3-linux-x64.tar.xz
fi
cd "$HOME/run/yangrunde/footprints-material-white-20261012"
sbatch preview-seas.slurm
