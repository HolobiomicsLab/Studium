#!/bin/bash
set -e
cd "$(dirname "$0")/.."
rm -f demo-metabolomics-bundle.zip
cd demo-metabolomics
# C5: a matching approval record travels inside the zip as the member approval.json, bound to the
# bytes of the lesson.json member; the server reads it there. A stale record is left out, loudly.
members=(lesson.json assets/)
if [ -f approval.json ]; then
  want=$(python3 -I -c 'import json; print(json.load(open("approval.json")).get("bundle_sha256", ""))' 2>/dev/null || true)
  have=$(shasum -a 256 lesson.json | cut -d" " -f1)
  if [ "$want" = "$have" ]; then
    members+=(approval.json)
  else
    echo "approval.json does not match lesson.json: left out of the zip (approve the lesson again)" >&2
  fi
fi
zip -r ../demo-metabolomics-bundle.zip "${members[@]}"
echo "Built: $(pwd)/../demo-metabolomics-bundle.zip"
ls -la ../demo-metabolomics-bundle.zip
