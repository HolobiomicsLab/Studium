#!/bin/bash
# Build le bundle demo-atomistique en zip pour livraison Tauri Library.
set -e
cd "$(dirname "$0")/.."

rm -f demo-atomistique-bundle.zip

cd demo-atomistique
zip -r ../demo-atomistique-bundle.zip \
    lesson.json \
    abs-capsule/

echo "Built: $(pwd)/../demo-atomistique-bundle.zip"
ls -la ../demo-atomistique-bundle.zip
