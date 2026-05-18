#!/usr/bin/env bash
# Register the Telegram bot webhook with the secret token and the update
# types our backend handles. Idempotent (Telegram accepts re-registration).
#
# Required env (e.g. from api/local.settings.json or shell):
#   TELEGRAM_BOT_TOKEN          - the bot token
#   TELEGRAM_WEBHOOK_SECRET     - 1..256 chars [A-Za-z0-9_-]
#   APP_BASE_URL                - https://<swa-host>  (no trailing slash)
#
# Usage:
#   ./scripts/set-webhook.sh
#   ./scripts/set-webhook.sh --delete    # remove the webhook
#
# Verification:
#   ./scripts/set-webhook.sh --info

set -euo pipefail

: "${TELEGRAM_BOT_TOKEN:?Missing TELEGRAM_BOT_TOKEN}"

case "${1:-set}" in
  --delete)
    curl -fsSL "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook" \
      -d 'drop_pending_updates=true'
    echo
    exit 0
    ;;
  --info)
    curl -fsSL "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
    echo
    exit 0
    ;;
esac

: "${TELEGRAM_WEBHOOK_SECRET:?Missing TELEGRAM_WEBHOOK_SECRET}"
: "${APP_BASE_URL:?Missing APP_BASE_URL}"

URL="${APP_BASE_URL%/}/api/telegram/webhook"

curl -fsSL "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${URL}" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message","my_chat_member","chat_member","chat_join_request","callback_query"]' \
  --data-urlencode 'drop_pending_updates=true'
echo
