# Production Lessons — WhatsApp Agent (SAAN/Anestex)

Documented failures and fixes from running in production since 2026-04-30.

## Table of Contents
1. Chrome Memory Leak
2. EnvironmentFile Missing
3. Direct Trigger vs Timer
4. Message Deduplication
5. Session Corruption
6. Dedicated Number Discipline

---

## 1. Chrome Memory Leak

**Symptom:** Server RAM fills up progressively; process killed by OOM; entire server rebooted.  
**Documented peaks:** 10.7 GB, 10.8 GB (killed server), triggered 5 crashes in 10 days before fix.

**Root cause:** Puppeteer/Chrome does not release memory properly in headless long-running mode.

**Fix (mandatory in systemd unit):**
```ini
MemoryMax=2G           # hard cap — OOM kills the service, not the server
MemoryHigh=1800M       # throttle at 1.8G before hitting cap
MemorySwapMax=0        # CRITICAL: prevents Chrome from reserving swap and locking the server
OOMPolicy=stop         # clean stop on OOM kill (not restart loop)
OOMScoreAdjust=500     # Chrome is killed first, not critical system processes
RuntimeMaxSec=43200    # force restart every 12h to clear the leak
```

**Why `RuntimeMaxSec=43200` is safe:** WhatsApp session data is persisted to disk (`LocalAuth`). Restarting the service does NOT require a new QR scan — the session reloads automatically.

**Measured baseline:** Chrome at ~1.4 GB after 5h26min uptime (healthy). Without `RuntimeMaxSec`, it would exceed 2G by ~8-10h.

---

## 2. EnvironmentFile Missing

**Symptom:** LLM calls fail silently; bot falls back to static error message instead of LLM response.  
**Root cause:** `node` launched by systemd does not inherit shell environment variables. `MODELO_API_KEY` was undefined in the process environment.

**Fix:**
```ini
EnvironmentFile=-/run/openclaw-env
```

Also add `loadOpenClawEnv()` in `listener.js` to ensure vars are available when the processor is triggered via `execFile` (inherits `process.env`, which must already have the key loaded).

---

## 3. Direct Trigger vs Timer Only

**Symptom:** Response latency was 3+ minutes instead of 15–25 seconds.  
**Root cause:** Processor was triggered only by a 5-minute systemd timer. Messages sat in queue waiting.

**Fix:** In `listener.js`, call `triggerProcessor()` immediately on message receipt:
```js
client.on('message', async (msg) => {
  // ...
  enqueueMessage(msg);
  triggerProcessor(); // ← direct trigger, not just timer
});
```

The timer remains as a **fallback only** (in case direct trigger fails). It is not the primary path.

---

## 4. Message Deduplication

**Symptom:** Some messages received two responses after service restart.  
**Root cause:** On restart, the `message` event can re-fire for recent messages. Without dedup, the same message gets processed twice.

**Fix:** Maintain `processed-message-ids.json` with a rolling window of 500 IDs. Check before processing any message.

```js
if (processedIds.includes(msgId)) return; // already handled
```

---

## 5. Session Corruption

**Symptom:** After a crash or improper shutdown, the service starts but loops on QR (never connects).  
**Root cause:** The `LocalAuth` session directory was left in a partial/corrupt state.

**Fix:**
```bash
systemctl stop <agentname>-listener
rm -rf /root/.openclaw/data/whatsapp-auth-<agentname>/session-<agentname>-listener
systemctl start <agentname>-listener
# New QR appears in logs → scan with dedicated phone
```

---

## 6. Dedicated Number Discipline

**Rule:** The dedicated number must stay permanently connected to the server's WhatsApp Web session.

If someone opens WhatsApp on the physical phone and disconnects the linked device:
- The session becomes invalid
- The bot stops responding
- A new QR scan is required

**Mitigation:**
- Use a SIM that stays in a drawer (not someone's daily phone)
- Alternatively, use an eSIM on a device that is never actively used as a WhatsApp device
- `RuntimeMaxSec` restarts do NOT disconnect the session — only the device disconnecting it does
