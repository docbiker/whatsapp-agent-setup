# Emergency Procedures — WhatsApp Agent

Quick reference for incidents. Always run smoke test after any intervention.

## Service Down / Not Responding

```bash
systemctl restart <agentname>-listener
sleep 10
journalctl -u <agentname>-listener -n 10 --no-pager
# Expected: "[OK] WhatsApp connected and ready!"
```

---

## Session Expired (QR Loop)

Service running but stuck requesting QR or never connecting:

```bash
# Option 1: Re-pair (session still intact)
systemctl stop <agentname>-listener
cd /root/<agentname>/whatsapp
node listener.js    # QR appears → scan with dedicated phone
# After "connected and ready!" → Ctrl+C
systemctl start <agentname>-listener
```

---

## Session Corrupted (QR never resolves)

```bash
systemctl stop <agentname>-listener
rm -rf /root/.openclaw/data/whatsapp-auth-<agentname>/session-<agentname>-listener
systemctl start <agentname>-listener
# New QR appears in logs → scan
journalctl -u <agentname>-listener -f   # watch for "connected and ready!"
```

---

## High Memory / Server Struggling

```bash
# Check who is eating RAM
ps aux --sort=-%mem | head -10
systemctl status <agentname>-listener | grep Memory

# Force restart (frees Chrome memory; session persists)
systemctl restart <agentname>-listener
```

If `MemoryMax` not in unit file → add it immediately (see production-lessons.md §1).

---

## Queue Stuck (Messages Accumulating)

```bash
# Inspect queue
cat /root/<agentname>/queue/inbound.json

# Force processor manually
node /root/<agentname>/whatsapp/processor.js

# Check processor log
journalctl -u <agentname>-listener --since "10 minutes ago" | grep -i "processor\|error"
```

---

## MODELO_API_KEY Missing (Fallback Static Responses)

```bash
# Check if key is loaded
grep OPENROUTER /run/openclaw-env

# If empty → reload environment
python3 /root/.openclaw/load-env.py
systemctl restart <agentname>-listener
```

---

## Confirm Recovery

After any procedure:
```bash
# 1. Service status
systemctl status <agentname>-listener --no-pager

# 2. Recent logs
journalctl -u <agentname>-listener --since "5 minutes ago" --no-pager

# 3. Send a test WhatsApp message to the number and time the response
# Expected: response in 15–25 seconds
```
