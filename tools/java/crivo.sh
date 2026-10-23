#!/usr/bin/env bash
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
out="$dir/out"
if [ ! -d "$out" ] || [ -n "$(find "$dir/src" -newer "$out" -name '*.java' -print -quit)" ]; then
  mkdir -p "$out"
  javac -encoding UTF-8 -d "$out" $(find "$dir/src" -name '*.java')
  touch "$out"
fi
exec java -cp "$out" io.github.ravelroot.crivo.Crivo "$@"
