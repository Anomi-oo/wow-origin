#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f Dockerfile \
  -t aduoer-wow:local \
  .
