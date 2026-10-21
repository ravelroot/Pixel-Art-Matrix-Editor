#!/usr/bin/env bash
set -euo pipefail
pasta="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$pasta/out-teste"
mkdir -p "$pasta/out-teste"
javac -encoding UTF-8 -d "$pasta/out-teste" $(find "$pasta/src" "$pasta/teste" -name '*.java')
java -cp "$pasta/out-teste" io.github.ravelroot.crivo.Testes "$pasta/../../exemplos"
