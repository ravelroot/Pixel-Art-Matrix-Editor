#!/usr/bin/env bash
set -euo pipefail
pasta="$(cd "$(dirname "$0")" && pwd)"
saida="$pasta/out"
if [ ! -d "$saida" ] || [ -n "$(find "$pasta/src" -newer "$saida" -name '*.java' -print -quit)" ]; then
  mkdir -p "$saida"
  javac -encoding UTF-8 -d "$saida" $(find "$pasta/src" -name '*.java')
  touch "$saida"
fi
exec java -cp "$saida" io.github.ravelroot.crivo.Crivo "$@"
