#!/bin/sh
# Run after first deploy to pin all image digests (supply-chain security).
# Usage: ./scripts/pin-images.sh
set -e
for IMAGE in "traefik:v3.6.15" "golang:1.22-alpine" "gcr.io/distroless/static-debian12:nonroot"; do
    docker pull "$IMAGE" >/dev/null 2>&1
    DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo "")
    echo "$IMAGE  =>  ${DIGEST:-UNAVAILABLE}"
done
echo ""
echo "Replace image tags in docker-compose.yml and Dockerfile with the digests above."
