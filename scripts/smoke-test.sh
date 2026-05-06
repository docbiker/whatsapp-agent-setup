#!/usr/bin/env bash
# smoke-test.sh — End-to-end validation for whatsapp-agent-setup
#
# Usage:
#   ./smoke-test.sh <agentname>
#
# Runs four checks. Exits non-zero on any failure.
# CUSTOMIZE: nothing — pass <agentname> as argument.

set -u

AGENT="${1:-}"
if [ -z "$AGENT" ]; then
  echo "usage: $0 <agentname>" >&2
  exit 2
fi

SERVICE="${AGENT}-listener"
KEY_VAR="${LLM_API_KEY_VAR:-MODELO_API_KEY}"
QUEUE_DIR="/root/${AGENT}/queue"
FAIL=0

pass() { echo "  [OK]   $1"; }
fail() { echo "  [FAIL] $1" >&2; FAIL=1; }

echo "=== 1. Service status ==="
if systemctl is-active --quiet "$SERVICE"; then
  pass "service active"
  systemctl status "$SERVICE" --no-pager | grep -E "Active:|Memory:" | sed 's/^/  /'
else
  fail "service not active — check: systemctl status $SERVICE"
fi

echo ""
echo "=== 2. Recent logs (looking for 'ready' and absence of errors) ==="
LOGS=$(journalctl -u "$SERVICE" -n 50 --no-pager 2>/dev/null || true)
if echo "$LOGS" | grep -q "WhatsApp connected and ready"; then
  pass "session ready"
else
  fail "no 'connected and ready' line in last 50 log entries"
fi
ERROR_COUNT=$(echo "$LOGS" | grep -ciE "\[HANDLER ERROR\]|\[SEND ERROR\]" || true)
if [ "$ERROR_COUNT" -eq 0 ]; then
  pass "no handler/send errors in recent logs"
else
  fail "$ERROR_COUNT error line(s) in recent logs — inspect with: journalctl -u $SERVICE -n 100"
fi

echo ""
echo "=== 3. API key in service environment ==="
ENV_OUTPUT=$(systemctl show "$SERVICE" -p Environment 2>/dev/null || echo "")
if echo "$ENV_OUTPUT" | grep -qE "${KEY_VAR}=.{6}"; then
  pass "$KEY_VAR present in service environment"
else
  fail "$KEY_VAR not loaded — check EnvironmentFile and /run/openclaw-env"
fi

echo ""
echo "=== 4. Queue directory healthy ==="
if [ -d "$QUEUE_DIR" ]; then
  pass "queue dir exists: $QUEUE_DIR"
  INBOUND_LEN=$(python3 -c "import json,sys; sys.exit(0); " 2>/dev/null && \
    python3 -c "import json; print(len(json.load(open('$QUEUE_DIR/inbound.json'))))" 2>/dev/null || echo "0")
  if [ "$INBOUND_LEN" -gt 5 ]; then
    fail "inbound queue has $INBOUND_LEN messages waiting — processor may be stuck"
  else
    pass "inbound queue clear ($INBOUND_LEN pending)"
  fi
else
  fail "queue dir missing: $QUEUE_DIR"
fi

echo ""
echo "=== Manual final step ==="
echo "  Send a real WhatsApp message to the dedicated number."
echo "  Expected: response in 15–25s, coherent with SYSTEM_PROMPT."
echo ""

if [ "$FAIL" -ne 0 ]; then
  echo "SMOKE TEST FAILED — fix above before declaring the bot live." >&2
  exit 1
fi

echo "SMOKE TEST PASSED — proceed with manual end-to-end check."
