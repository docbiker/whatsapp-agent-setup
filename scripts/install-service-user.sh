#!/usr/bin/env bash
# install-service-user.sh — Migrate a v1.0.0/v1.1.0 deployment from User=root
# to a dedicated, unprivileged service user (User=openclaw-wa).
#
# Idempotent: safe to re-run. Detects what's already in place and skips it.
#
# Usage:
#   sudo bash install-service-user.sh <agentname>
#
# What it does:
#   1. Creates system user `openclaw-wa` (no shell, no home) if missing.
#   2. Moves /root/<agentname>/ → /opt/<agentname>/ if still under /root.
#   3. Moves WhatsApp auth dir → /var/lib/<agentname>/whatsapp-auth/.
#   4. Updates path constants inside listener.js, processor.js, smoke-test.sh.
#   5. Updates the systemd unit: User=openclaw-wa + new WorkingDirectory + ExecStart.
#   6. chowns everything to openclaw-wa.
#   7. Reloads systemd and restarts the service.
#
# Safe rollback: the original /root paths are renamed (not deleted) to
#   /root/<agentname>.pre-v1.2.0-migration so you can revert manually.

set -euo pipefail

AGENT="${1:-}"
if [ -z "$AGENT" ]; then
  echo "usage: sudo bash $0 <agentname>" >&2
  exit 2
fi

if [ "$EUID" -ne 0 ]; then
  echo "must run as root (sudo)" >&2
  exit 2
fi

SERVICE_USER="openclaw-wa"
OLD_BASE="/root/${AGENT}"
NEW_BASE="/opt/${AGENT}"
NEW_AUTH_PARENT="/var/lib/${AGENT}"
NEW_AUTH_DIR="${NEW_AUTH_PARENT}/whatsapp-auth"
SERVICE_FILE="/etc/systemd/system/${AGENT}-listener.service"

step() { echo ""; echo "=== $1 ==="; }

# ---------------------------------------------------------------------------
step "1. Service user"
if id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "  user $SERVICE_USER already exists — skipping"
else
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  echo "  created system user: $SERVICE_USER"
fi

# ---------------------------------------------------------------------------
step "2. Stop service before moving files"
if systemctl is-active --quiet "${AGENT}-listener"; then
  systemctl stop "${AGENT}-listener"
  echo "  stopped ${AGENT}-listener"
else
  echo "  ${AGENT}-listener not active — skipping"
fi

# ---------------------------------------------------------------------------
step "3. Move agent directory: $OLD_BASE → $NEW_BASE"
if [ -d "$NEW_BASE" ]; then
  echo "  $NEW_BASE already exists — assuming previous migration, skipping move"
elif [ -d "$OLD_BASE" ]; then
  mkdir -p "$(dirname "$NEW_BASE")"
  cp -a "$OLD_BASE" "$NEW_BASE"
  mv "$OLD_BASE" "${OLD_BASE}.pre-v1.2.0-migration"
  echo "  moved (original kept at ${OLD_BASE}.pre-v1.2.0-migration for rollback)"
else
  echo "  ERROR: neither $OLD_BASE nor $NEW_BASE found" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
step "4. Move WhatsApp auth directory"
OLD_AUTH_CANDIDATES=(
  "/root/.openclaw/data/whatsapp-auth-${AGENT}"
  "${NEW_BASE}/.openclaw/data/whatsapp-auth-${AGENT}"
)
mkdir -p "$NEW_AUTH_PARENT"

if [ -d "$NEW_AUTH_DIR" ]; then
  echo "  $NEW_AUTH_DIR already exists — skipping"
else
  MOVED=0
  for CANDIDATE in "${OLD_AUTH_CANDIDATES[@]}"; do
    if [ -d "$CANDIDATE" ]; then
      cp -a "$CANDIDATE" "$NEW_AUTH_DIR"
      mv "$CANDIDATE" "${CANDIDATE}.pre-v1.2.0-migration"
      echo "  moved from $CANDIDATE → $NEW_AUTH_DIR"
      MOVED=1
      break
    fi
  done
  if [ "$MOVED" -eq 0 ]; then
    echo "  no existing auth dir found — fresh QR pairing will be needed after migration"
    mkdir -p "$NEW_AUTH_DIR"
  fi
fi

# ---------------------------------------------------------------------------
step "5. Update path constants in scripts"
SCRIPTS_DIR="${NEW_BASE}/whatsapp"
for FILE in "${SCRIPTS_DIR}/listener.js" "${SCRIPTS_DIR}/processor.js" "${SCRIPTS_DIR}/smoke-test.sh"; do
  if [ -f "$FILE" ]; then
    # Replace /root/<agent>/ → /opt/<agent>/
    sed -i.bak "s|/root/${AGENT}/|/opt/${AGENT}/|g" "$FILE"
    # Replace old auth path → new auth path
    sed -i "s|/root/.openclaw/data/whatsapp-auth-${AGENT}|${NEW_AUTH_DIR}|g" "$FILE"
    rm -f "${FILE}.bak"
    echo "  updated paths in $(basename "$FILE")"
  fi
done

# ---------------------------------------------------------------------------
step "6. Update systemd unit"
if [ -f "$SERVICE_FILE" ]; then
  cp "$SERVICE_FILE" "${SERVICE_FILE}.pre-v1.2.0-migration"
  sed -i \
    -e "s|^User=root|User=${SERVICE_USER}|" \
    -e "s|^WorkingDirectory=/root/${AGENT}/whatsapp|WorkingDirectory=${SCRIPTS_DIR}|" \
    -e "s|^ExecStart=/usr/bin/node /root/${AGENT}/whatsapp/listener.js|ExecStart=/usr/bin/node ${SCRIPTS_DIR}/listener.js|" \
    "$SERVICE_FILE"
  echo "  updated $SERVICE_FILE (backup at ${SERVICE_FILE}.pre-v1.2.0-migration)"
else
  echo "  WARNING: $SERVICE_FILE not found — you'll need to install it manually" >&2
fi

# ---------------------------------------------------------------------------
step "7. Permissions & ownership"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$NEW_BASE"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$NEW_AUTH_PARENT"
# Tighten queue & auth so only the service user can read
chmod 0700 "$NEW_BASE" "$NEW_AUTH_PARENT" "$NEW_AUTH_DIR"
if [ -d "${NEW_BASE}/queue" ]; then
  chmod 0700 "${NEW_BASE}/queue"
  find "${NEW_BASE}/queue" -type f -exec chmod 0600 {} +
fi
echo "  ownership set to ${SERVICE_USER}, queue/auth files set to 0600"

# ---------------------------------------------------------------------------
step "8. Reload & restart"
systemctl daemon-reload
systemctl start "${AGENT}-listener"
sleep 3
if systemctl is-active --quiet "${AGENT}-listener"; then
  echo "  ${AGENT}-listener restarted successfully under ${SERVICE_USER}"
else
  echo "  ERROR: service did not start. Check: journalctl -u ${AGENT}-listener -n 50" >&2
  exit 1
fi

echo ""
echo "=========================================="
echo " Migration complete."
echo " Old paths (kept for rollback):"
echo "   ${OLD_BASE}.pre-v1.2.0-migration"
echo "   ${SERVICE_FILE}.pre-v1.2.0-migration"
echo " New layout:"
echo "   App:   ${NEW_BASE}"
echo "   Auth:  ${NEW_AUTH_DIR}"
echo "   User:  ${SERVICE_USER}"
echo " Verify with: bash ${SCRIPTS_DIR}/smoke-test.sh ${AGENT}"
echo "=========================================="
