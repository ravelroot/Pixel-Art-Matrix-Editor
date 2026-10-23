#!/usr/bin/env bash
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$dir/out-test"
mkdir -p "$dir/out-test"
javac -encoding UTF-8 -d "$dir/out-test" $(find "$dir/src" "$dir/test" -name '*.java')
java -cp "$dir/out-test" io.github.ravelroot.crivo.Tests "$dir/../../examples"
