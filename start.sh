#!/bin/sh
set -e

cd "$(dirname "$0")"

if [ ! -f .env.example ]; then
    echo ""
    echo "  ✖  ERROR: .env.example not found."
    echo "     Make sure you run this script from the mailhsc directory."
    echo ""
    exit 1
fi

if [ ! -f .env ]; then
    cp .env.example .env
    chmod 600 .env
    echo ""
    echo "  ✔  .env created from .env.example."
    echo "     Default mode: standalone (http://localhost:8080)."
    echo "     For production with HTTPS: set DEPLOY_MODE=full and configure DOMAIN."
    echo ""
fi

# Block if full mode with placeholder email and non-localhost domain
if grep -q "^DEPLOY_MODE=full" .env; then
    if grep -q "^TRAEFIK_ACME_EMAIL=admin@yourdomain.com" .env && ! grep -q "^DOMAIN=localhost" .env; then
        echo ""
        echo "  ✖  ERROR: TRAEFIK_ACME_EMAIL is still the placeholder value."
        echo "     Edit .env and set a real email address for Let's Encrypt."
        echo ""
        exit 1
    fi
fi

MODE=$(grep "^DEPLOY_MODE=" .env | cut -d= -f2 | tr -d '[:space:]')
MODE=${MODE:-standalone}

if [ "$MODE" = "full" ]; then
    echo "  ▶  Starting MailHSC (full mode — Traefik + HTTPS)..."
    docker compose -f docker-compose.yml up -d
elif [ "$MODE" = "standalone" ]; then
    PORT=$(grep "^STANDALONE_PORT=" .env | cut -d= -f2 | tr -d '[:space:]')
    PORT=${PORT:-8080}
    echo "  ▶  Starting MailHSC (standalone mode — http://localhost:${PORT})..."
    docker compose -f docker-compose.standalone.yml up -d
else
    echo ""
    echo "  ✖  ERROR: unknown DEPLOY_MODE='${MODE}'. Use 'full' or 'standalone'."
    echo ""
    exit 1
fi
