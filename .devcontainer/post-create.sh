#!/usr/bin/env bash
# Devcontainer post-create: install Azure Functions Core Tools + workspace deps.
set -euo pipefail

echo "==> Installing Azure Functions Core Tools v4 (global)"
# Use npm global install (works on Debian devcontainer image without extra apt repos).
sudo npm install -g azure-functions-core-tools@4 --unsafe-perm true

echo "==> Installing workspace dependencies"
npm install

echo "==> Seeding api/local.settings.json from example (if missing)"
if [ ! -f api/local.settings.json ] && [ -f api/local.settings.json.example ]; then
  cp api/local.settings.json.example api/local.settings.json
  echo "    -> created api/local.settings.json (REMEMBER to fill in real secrets)"
fi

echo "==> Versions"
node --version
npm --version
func --version || true
swa --version || true
az --version | head -n 1 || true

echo "==> Done. Try: npm run dev"
