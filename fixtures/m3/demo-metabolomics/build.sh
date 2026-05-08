#!/bin/bash
set -e
cd "$(dirname "$0")/.."
rm -f demo-metabolomics-bundle.zip
cd demo-metabolomics
zip -r ../demo-metabolomics-bundle.zip lesson.json assets/
echo "Built: $(pwd)/../demo-metabolomics-bundle.zip"
ls -la ../demo-metabolomics-bundle.zip
