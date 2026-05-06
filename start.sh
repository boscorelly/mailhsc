#!/bin/sh
set -e

# Always run from the directory containing this script
cd "$(dirname "$0")"

# Verify .env.example exists
if [ ! -f .env.example ]; then
    echo ""
    echo "  ✖  ERROR: .env.example not found."
    echo "     Make sure you run this script from the mailhsc directory."
    echo ""
    exit 1
fi

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    chmod 600 .env
    echo ""
    echo "  ✔  .env created from .env.example."
    echo "     Local dev ready: https://localhost (self-signed cert, accept browser warning)."
    echo "     For production: set DOMAIN and TRAEFIK_ACME_EMAIL in .env then re-run."
    echo ""
fi

# Block if TRAEFIK_ACME_EMAIL is still the placeholder AND domain is not localhost
if grep -q "^TRAEFIK_ACME_EMAIL=admin@yourdomain.com" .env && ! grep -q "^DOMAIN=localhost" .env; then
    echo ""
    echo "  ✖  ERROR: TRAEFIK_ACME_EMAIL is still the placeholder value."
    echo "     Edit .env and set a real email address for Let's Encrypt."
    echo ""
    exit 1
fi

echo "  ▶  Starting MailLens..."
docker compose up -d
