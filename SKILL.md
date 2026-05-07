---
name: whatsapp-agent-setup
version: 1.2.0
description: "Connect a WhatsApp number to an OpenClaw agent without the Meta API, using whatsapp-web.js (Puppeteer). Use this skill when asked to set up WhatsApp for an agent, connect a dedicated number to OpenClaw, build a WhatsApp listener/responder, integrate WhatsApp without Business API, create a bot that receives and sends WhatsApp messages, or configure wwebjs for an AI agent. Triggers on phrases like 'conectar WhatsApp ao agente', 'WhatsApp sem API Meta', 'listener WhatsApp', 'configurar whatsapp-web.js', 'bot WhatsApp OpenClaw', 'plugar número no agente'. Provider-agnostic LLM layer (OpenAI-compatible). Channel security flags + execution hardening (dedicated service user, pinned dependencies, file permissions, log rotation). Production-validated since 2026-04."
---

```
 _                            _   _                  _            _
(_)_ __  _ __   _____   ____ _| |_(_) ___  _ __    __| | ___   ___| |_ ___  _ __
| | '_ \| '_ \ / _ \ \ / / _` | __| |/ _ \| '_ \  / _` |/ _ \ / __| __/ _ \| '__|
| | | | | | | | (_) \ V / (_| | |_| | (_) | | | || (_| | (_) | (__| || (_) | |
|_|_| |_|_| |_|\___/ \_/ \__,_|\__|_|\___/|_| |_(_)__,_|\___/ \___|\__\___/|_|

   @innovation.doctor  ·  skill by Doc  ·  OpenClaw stack
```

# whatsapp-agent-setup

Connects a dedicated WhatsApp number to an OpenClaw agent using whatsapp-web.js (Puppeteer). No Meta Business API required. LLM layer is provider-agnostic (any OpenAI-compatible endpoint).

**Production-validated since 2026-04-30.**
**Response latency:** 15–25 seconds end-to-end.

## Why this skill exists

The point is to bypass Meta's WhatsApp Business API right now. The official path requires a verified Business Manager, a BSP integration, template approval cycles, and weeks of waiting. For internal agents, prototypes, or low-volume use cases that need to be live this week — not next quarter — this skill is the pragmatic shortcut. The trade-offs (no SLA, ban risk at scale, single-device limit) are real and documented under "When NOT to use this skill".

## When NOT to use this skill

- **High-volume / public-facing customer support** (>1k msgs/day, multi-attendant routing, official badge needed) → use Meta's WhatsApp Business API or a BSP. Puppeteer-based bots get banned at scale and have no SLA.
- **Already running a wwebjs listener for the same number** — destroying the active session is harder than reusing it. Inspect `systemctl list-units '*-listener.service'` first.
- **No dedicated SIM available** — do not use a personal number.
- **No LLM provider configured** — set up the API key and model list in `/run/openclaw-env` before this skill, not during.

## Architecture

```
User (WhatsApp)
  → listener.js        [filter chain → dedup → typing indicator → triggers processor]
  → processor.js       [reads queue, calls Python, writes response]
  → api-handler.py     [LLM call — provider-agnostic, OpenAI-compatible]
  → listener.js        [5s loop → sends response]
```

### Queue files anatomy

| File | Written by | Read by | Purpose |
|------|-----------|---------|---------|
| `inbound.json` | listener | processor | Messages waiting to be processed |
| `outbound.json` | processor | listener | Responses ready to send (5s loop) |
| `processed-message-ids.json` | listener | listener | Rolling 500-ID dedup window (survives restarts) |
| `processed.json` | processor | (archive) | Last 200 handled messages — debugging only |
| `read-only-log.json` | listener | (archive) | When `READ_ONLY=true`, captured messages land here instead of inbound |

All writes use the write-tmp + rename pattern (atomic on the same filesystem). Permissions are `0600` (owner only) when deployed under the production-internal or production-public hardening profile (see below).

---

## Hardening profile (v1.2.0+)

Three deployment profiles, each with a concrete sequence of scripts. Pick one **before** Step 1 of the workflow.

### Lab — fast & disposable

For prototyping on a throwaway VPS. Defaults to `User=root`, paths under `/root/`, dependencies installed without lock file. Quick to set up, easy to nuke.

| Property | Value |
|----------|-------|
| Service user | `root` |
| App path | `/root/<agentname>/` |
| Auth path | `/root/.openclaw/data/whatsapp-auth-<agentname>` |
| Dependencies | latest (`npm install whatsapp-web.js qrcode-terminal` + `pip3 install openai`) |
| File permissions | default umask |
| Log rotation | none |
| Setup scripts | none required |

### Production-internal — closed deployment pattern (recommended baseline)

Closed deployment, known contacts, no public exposure. Service user, scoped paths, pinned deps, locked-down permissions.

| Property | Value |
|----------|-------|
| Service user | `openclaw-wa` (system, no shell) |
| App path | `/opt/<agentname>/` |
| Auth path | `/var/lib/<agentname>/whatsapp-auth/` |
| Dependencies | pinned via `package.json` + `requirements.txt` |
| File permissions | `0700` dirs, `0600` queue/auth files |
| Log rotation | `/etc/logrotate.d/<agentname>` (daily, 7-day retention) |
| Setup scripts | `install-service-user.sh` + `secure-permissions.sh` |

### Production-public — only if you really know what you're doing

Same as production-internal **plus** active allowlist, `READ_ONLY=true` initially, and a separate skill handling draft-and-approve workflow. The channel layer (this skill) only captures and forwards via `read-only-log.json`; reply approval lives elsewhere.

| Property | Same as production-internal, plus: |
|----------|-----------------------------------|
| `ALLOWED_CONTACTS` | required, non-empty |
| `READ_ONLY` | `true` for fase 1 |
| Approval workflow | external skill consuming `read-only-log.json` and writing to `outbound.json` |

---

## Channel security (v1.1.0+)

Three opt-in env vars (set in `/run/openclaw-env`) control the listener filter chain:

| Variable | Default | Effect |
|----------|---------|--------|
| `ALLOW_GROUPS` | `false` | When `false`, any message from a JID ending in `@g.us` is dropped. |
| `ALLOWED_CONTACTS` | `""` | CSV of JIDs (`<phone>@c.us`). Non-empty = allowlist active; everything else dropped. |
| `READ_ONLY` | `false` | When `true`: capture to `read-only-log.json`, no LLM, no reply, outbound loop disabled. |

**Filter chain order**: `fromMe` → groups → broadcast → allowlist → dedup. Drops at any stage produce a `[BLOCK] from=<jid> reason=<stage>` log line and exit early — no LLM cost, no traces in `processed.json`.

---

## Variables to define before starting

### Agent identity & paths

Paths depend on the chosen hardening profile. The Lab profile uses `/root/`, production profiles use `/opt/` + `/var/lib/`.

| Variable | Lab default | Production default |
|----------|-------------|--------------------|
| Working dir | `/root/<agentname>/whatsapp` | `/opt/<agentname>/whatsapp` |
| Queue dir | `/root/<agentname>/queue` | `/opt/<agentname>/queue` |
| Auth dir | `/root/.openclaw/data/whatsapp-auth-<agentname>` | `/var/lib/<agentname>/whatsapp-auth` |
| Service user | `root` | `openclaw-wa` |

For Lab, write paths directly into the scripts (search `<agentname>` and replace). For Production-*, use Lab paths first, then run `install-service-user.sh` which migrates everything.

### LLM configuration (in `/run/openclaw-env`)

| Env var | Required | Default | Notes |
|---------|----------|---------|-------|
| `LLM_BASE_URL` | no | `https://openrouter.ai/api/v1` | Any OpenAI-compatible endpoint |
| `LLM_API_KEY_VAR` | no | `MODELO_API_KEY` | Name of env var holding the API key |
| *(the API key)* | **yes** | — | Stored under whatever name `LLM_API_KEY_VAR` points to |
| `LLM_MODELS` | **yes** | — | CSV, primary first, fallback chain |
| `LLM_TIMEOUT` | no | `30` | Per-call seconds |
| `LLM_MAX_TOKENS` | no | `500` | Output cap |

### Channel security (also in `/run/openclaw-env`)

| Env var | Default | Notes |
|---------|---------|-------|
| `ALLOW_GROUPS` | `false` | See "Channel security" above |
| `ALLOWED_CONTACTS` | `""` | CSV of `<phone>@c.us` JIDs |
| `READ_ONLY` | `false` | Capture-only mode |

**Recommended fallback strategy: cross-provider.** A chain stacked on a single vendor doesn't survive that vendor's rate-limit / overload events. Example for OpenRouter:

```bash
LLM_BASE_URL=https://openrouter.ai/api/v1
MODELO_API_KEY=sk-or-...
LLM_MODELS=anthropic/claude-haiku-4-5,openai/gpt-4o-mini,google/gemini-2.0-flash
ALLOW_GROUPS=false
ALLOWED_CONTACTS=5548999999999@c.us
READ_ONLY=false
```

> ⚠️ Verify model slugs against the chosen provider's catalog at the moment of deployment. The skill does not validate them — invalid slugs trigger silent fallback.

---

## Workflow

### Step 0 — Pick a hardening profile

Lab, Production-internal, or Production-public (see table above). The rest of the workflow branches based on this choice.

### Step 1 — Prerequisites

- VPS Ubuntu 22.04+, **minimum 4 GB RAM** (Chrome is hungry — see production-lessons §1)
- Node.js 18+, Python 3, pip
- Dedicated WhatsApp number (physical SIM or eSIM — never personal — see production-lessons §6)
- LLM provider chosen and credentials ready to go into `/run/openclaw-env`
- Channel security vars decided

### Step 2 — Install dependencies (pinned)

For Lab profile:
```bash
mkdir -p /root/<agentname>/whatsapp /root/<agentname>/queue
cd /root/<agentname>/whatsapp
cp /path/to/skill/package.json .
cp /path/to/skill/requirements.txt .
npm install
pip3 install -r requirements.txt
```

For Production profiles, same commands but in `/opt/<agentname>/whatsapp/` (the migration script will move from `/root/` later if you started there).

`npm install` honors `package.json` and produces `package-lock.json` — commit that lock file alongside the deploy if you version-control the agent.

### Step 3 — Create the components

Copy templates from `scripts/`:
- `listener.js`, `processor.js` → adjust paths and queue dir
- `api-handler.py` → adjust `SYSTEM_PROMPT` only (provider config comes from env)
- `listener.service` → adjust `WorkingDirectory`, `ExecStart`, `SyslogIdentifier`
- `smoke-test.sh` → no edits

All customization points are marked with `# CUSTOMIZE`. Search for `<agentname>` in all four files before moving on.

### Step 4 — Install systemd unit

```bash
sudo cp listener.service /etc/systemd/system/<agentname>-listener.service
sudo systemctl daemon-reload
sudo systemctl enable <agentname>-listener
```

### Step 5 — First QR pairing (SSH terminal only)

**Why SSH only:** the QR code is rendered as ASCII in stdout. If you trigger pairing through any agent or chat-based interface, the QR ends up escaped, truncated, or rendered in a context the user can't scan from. Always do this from a real interactive SSH terminal.

```bash
sudo systemctl stop <agentname>-listener
cd <working-dir>
node listener.js                      # QR appears in terminal
# On dedicated phone: WhatsApp → Linked Devices → Link a Device → scan QR
# Wait for: "[OK] WhatsApp connected and ready!"
# Then: Ctrl+C
sudo systemctl start <agentname>-listener
```

### Step 6 — Add credentials & config to `/run/openclaw-env`

Load via `load-env.py` + 1Password. The systemd unit reads it via `EnvironmentFile=/run/openclaw-env` — **this line is critical**. Without it, neither the `LLM_*` vars nor the channel security flags reach the Node/Python processes (production-lessons §2).

### Step 7 — Hardening (Production profiles only)

Run **on the live deployment**, in this order:

```bash
sudo bash /path/to/scripts/install-service-user.sh <agentname>
sudo bash /path/to/scripts/secure-permissions.sh <agentname>
```

`install-service-user.sh` migrates from `/root/` to `/opt/` + `/var/lib/`, creates the `openclaw-wa` system user, rewrites paths inside the scripts, updates the systemd unit, and restarts the service. Idempotent — safe to re-run. Keeps backups at `*.pre-v1.2.0-migration` for rollback.

`secure-permissions.sh` sets `0700` on directories, `0600` on queue files, and installs `/etc/logrotate.d/<agentname>` rotating `processed.json` and `read-only-log.json` daily with 7-day retention.

Skip this step entirely for the Lab profile.

### Step 8 — Smoke test

```bash
bash <working-dir>/smoke-test.sh <agentname>
```

Five automated checks: service active, ready/error log scan, API key in service env, queue not stuck, channel security configuration. Exits non-zero on failure. Then the manual final step:

```
Send a real WhatsApp message to the dedicated number from an allowed contact.
- READ_ONLY=true:  expect NO reply; check read-only-log.json fills.
- READ_ONLY=false: expect reply in 15–25s, coherent with SYSTEM_PROMPT.
```

Also test: send from a non-allowlisted contact and from a group, verify both produce `[BLOCK]` log lines without any reply.

## Critical Production Lessons

See `references/production-lessons.md` for full details. Summary:

| Issue | Fix |
|-------|-----|
| Chrome memory leak (→ OOM crash) | `MemoryMax=2G` + `RuntimeMaxSec=43200` in unit file |
| API key missing in systemd context | `EnvironmentFile=/run/openclaw-env` in unit file |
| Slow responses (3+ min) | Direct `triggerProcessor()` call, not just timer |
| Double responses on restart | Message ID deduplication in `processed-message-ids.json` |
| Session corruption | `rm -rf <auth-dir>/session-*` + restart → new QR |
| Fallback chain silent failure | Cross-provider models in `LLM_MODELS`, not same-vendor stack |
| JSON queue corruption on crash | Atomic writes (write-tmp + rename) — built into v1.1.0+ |
| Dependency drift breaking install | Pinned `package.json` + `requirements.txt` — built into v1.2.0+ |
| Plaintext message history accessible | `0600` permissions + dedicated service user — `secure-permissions.sh` |

## Emergency Procedures

See `references/emergency-procedures.md`.

## NEVER do

- `openclaw channels login --account <agentname>` while listener is running — destroys the session
- Run `node listener.js` manually in parallel to systemd service — locks the session
- Use a personal number — anyone opening WhatsApp on the physical phone disconnects the linked device. The dedicated SIM/eSIM rule exists for this exact reason
- Hardcode provider slugs or keys in `api-handler.py` — everything goes through `/run/openclaw-env`
- Paste terminal outputs containing API keys into chat — they live in `/run/openclaw-env` only, loaded via `load-env.py`
- Deploy with `ALLOWED_CONTACTS` empty + `READ_ONLY=false` on a public-facing number without conscious decision — smoke test will warn about this combination
- Use the Lab hardening profile for a production deployment — root + unpinned deps + plaintext queue files is fine for prototyping, not for anything you care about

## Known limitations (acknowledged, not fixed)

- **Chromium runs with `--no-sandbox`.** Required when running headless on most VPS configurations. Mitigation: dedicated unprivileged user (production profile), systemd hardening flags. Not a candidate for fix without significant infrastructure investment.
- **Queue files are unencrypted JSON.** Mitigated by `0600` permissions + dedicated service user. Disk-level encryption (LUKS) is the right place for at-rest encryption, not application-level. Not a candidate for fix.
- **`whatsapp-web.js` is unofficial.** No SLA, ban risk at scale, breakage when WhatsApp Web changes. Documented in "Why this skill exists" and "When NOT to use". Not fixable — it's the foundational trade-off.

---

**Version 1.2.0** · See [CHANGELOG.md](./CHANGELOG.md) for history. Human-facing overview in [README.md](./README.md).
