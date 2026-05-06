---
name: whatsapp-agent-setup
version: 1.0.0
description: "Connect a WhatsApp number to an OpenClaw agent without the Meta API, using whatsapp-web.js (Puppeteer). Use this skill when asked to set up WhatsApp for an agent, connect a dedicated number to OpenClaw, build a WhatsApp listener/responder, integrate WhatsApp without Business API, create a bot that receives and sends WhatsApp messages, or configure wwebjs for an AI agent. Triggers on phrases like 'conectar WhatsApp ao agente', 'WhatsApp sem API Meta', 'listener WhatsApp', 'configurar whatsapp-web.js', 'bot WhatsApp OpenClaw', 'plugar número no agente', 'WhatsApp pra Sidecar/Salvy/SAAN'. Provider-agnostic LLM layer (OpenAI-compatible). Based on the SAAN/Anestex production implementation running since 2026-04."
---

```
 _                            _   _                  _            _
(_)_ __  _ __   _____   ____ _| |_(_) ___  _ __    __| | ___   ___| |_ ___  _ __
| | '_ \| '_ \ / _ \ \ / / _` | __| |/ _ \| '_ \  / _` |/ _ \ / __| __/ _ \| '__|
| | | | | | | | (_) \ V / (_| | |_| | (_) | | | || (_| | (_) | (__| || (_) | |
|_|_| |_|_| |_|\___/ \_/ \__,_|\__|_|\___/|_| |_(_)__,_|\___/ \___|\__\___/|_|

   @innovation.doctor  ·  skill by Doc  ·  Anestech  ·  OpenClaw stack
```

# whatsapp-agent-setup

Connects a dedicated WhatsApp number to an OpenClaw agent using whatsapp-web.js (Puppeteer). No Meta Business API required. LLM layer is provider-agnostic — any OpenAI-compatible endpoint works (OpenRouter, OpenAI, Anthropic, Together, Groq, vLLM/local, etc.).

**Reference implementation:** SAAN/Salvy (Anestex) — production since 2026-04-30.
**Response latency:** 15–25 seconds end-to-end.

## Why this skill exists

The point is to bypass Meta's WhatsApp Business API right now. The official path requires a verified Business Manager, a BSP integration, template approval cycles, and weeks of waiting. For internal agents, prototypes, or low-volume use cases that need to be live this week — not next quarter — this skill is the pragmatic shortcut: a dedicated SIM, Puppeteer, and a server with 4 GB of RAM. The trade-offs (no SLA, ban risk at scale, single-device limit) are real and documented under "When NOT to use this skill" — eyes open.

## When NOT to use this skill

- **High-volume / public-facing customer support** (>1k msgs/day, multi-attendant routing, official badge needed) → use Meta's WhatsApp Business API or a BSP (Twilio, Z-API, etc.). Puppeteer-based bots get banned at scale and have no SLA.
- **Already running a wwebjs listener for the same number** — destroying the active session is harder than reusing it. Inspect `systemctl list-units '*-listener.service'` first.
- **No dedicated SIM available** — do not use a personal number. Stop and acquire one before proceeding.
- **No LLM provider configured** — set up the API key and model list in `/run/openclaw-env` before this skill, not during.

## Architecture

```
User (WhatsApp)
  → listener.js        [receives, dedupes, typing indicator, triggers processor]
  → processor.js       [reads queue, calls Python, writes response]
  → api-handler.py     [LLM call — provider-agnostic, OpenAI-compatible]
  → listener.js        [5s loop → sends response]
```

Files live in an arbitrary directory (e.g. `/root/<agentname>/whatsapp/`).
Queue files live in a separate directory (e.g. `/root/<agentname>/queue/`).

### Queue files anatomy

Three JSON files coordinate listener ↔ processor (file-based queue, no Redis needed for low volume):

| File | Written by | Read by | Purpose |
|------|-----------|---------|---------|
| `inbound.json` | listener | processor | Messages waiting to be processed |
| `outbound.json` | processor | listener | Responses ready to send (5s loop) |
| `processed-message-ids.json` | listener | listener | Rolling 500-ID dedup window (survives restarts) |
| `processed.json` | processor | (archive) | Last 200 handled messages — debugging only |

If anything looks stuck, `cat`-ing these files tells you exactly where the pipeline is blocked.

---

## Variables to define before starting

Decide and write down these values before running anything. Every script has them marked with `# CUSTOMIZE` comments — keeping them consistent across all four files is what makes the setup work on the first try.

### Agent identity & paths

| Variable | Example | Where it appears |
|----------|---------|------------------|
| `<agentname>` | `salvy` | listener.js, processor.js, listener.service, all paths |
| `<AgentName>` (display) | `Salvy` | listener.service `Description=` |
| Working dir | `/root/salvy/whatsapp` | listener.service, paths |
| Queue dir | `/root/salvy/queue` | listener.js, processor.js |
| Auth dir | `/root/.openclaw/data/whatsapp-auth-salvy` | listener.js |
| `SYSTEM_PROMPT` | agent persona/rules in PT or EN | api-handler.py |

### LLM configuration (provider-agnostic, lives in `/run/openclaw-env`)

The `api-handler.py` does not hardcode any provider. All routing is via env vars loaded from `/run/openclaw-env`:

| Env var | Required | Default | Notes |
|---------|----------|---------|-------|
| `LLM_BASE_URL` | no | `https://openrouter.ai/api/v1` | Any OpenAI-compatible endpoint |
| `LLM_API_KEY_VAR` | no | `MODELO_API_KEY` | Name of the env var that holds the API key |
| *(the API key itself)* | **yes** | — | Stored under whatever name `LLM_API_KEY_VAR` points to |
| `LLM_MODELS` | **yes** | — | CSV, primary first, then fallback chain |
| `LLM_TIMEOUT` | no | `30` | Per-call seconds |
| `LLM_MAX_TOKENS` | no | `500` | Output cap |

**Recommended fallback strategy: cross-provider, not stacked on the same vendor.** A chain that's all on Anthropic (or all on OpenAI) gives no resilience against the most common failure mode — provider rate-limit / overload. See OpenClaw recurring incident pattern: false redundancy.

Three concrete configurations:

**A. OpenRouter (multi-provider, recommended for cross-vendor fallback)**
```bash
# /run/openclaw-env
LLM_BASE_URL=https://openrouter.ai/api/v1
MODELO_API_KEY=sk-or-...
LLM_MODELS=anthropic/claude-haiku-4-5,openai/gpt-4o-mini,google/gemini-2.0-flash
```

**B. OpenAI direct**
```bash
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY_VAR=OPENAI_API_KEY
OPENAI_API_KEY=sk-...
LLM_MODELS=gpt-4o-mini,gpt-4o
```

**C. Anthropic via OpenAI-compat endpoint**
```bash
LLM_BASE_URL=https://api.anthropic.com/v1/
LLM_API_KEY_VAR=ANTHROPIC_API_KEY
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODELS=claude-haiku-4-5,claude-sonnet-4-6
```

> ⚠️ Verify model slugs against the chosen provider's catalog at the moment of deployment. Slugs change. The skill does not validate them — invalid slugs just trigger the fallback chain silently.

If the user hasn't decided some of these yet, ask before generating files — placeholder leakage into production is the #1 source of "it doesn't work" reports.

---

## Workflow

### Step 1 — Prerequisites

- VPS Ubuntu 22.04+, **minimum 4 GB RAM** (Chrome is hungry — see production-lessons §1)
- Node.js 18+, Python 3, pip
- Dedicated WhatsApp number (physical SIM or eSIM — never personal — see production-lessons §6 for *why*)
- LLM provider chosen and credentials ready to go into `/run/openclaw-env`

### Step 2 — Install dependencies

```bash
mkdir -p /root/<agentname>/whatsapp /root/<agentname>/queue
cd /root/<agentname>/whatsapp
npm init -y
npm install whatsapp-web.js qrcode-terminal
pip3 install openai
```

### Step 3 — Create the components

Copy templates from `scripts/` and adjust:
- `scripts/listener.js` → paths, auth clientId, queue dir
- `scripts/processor.js` → paths, queue dir
- `scripts/api-handler.py` → SYSTEM_PROMPT only (provider config comes from env)
- `scripts/smoke-test.sh` → no edits needed

All customization points are marked with `# CUSTOMIZE` comments. Use the variables tables above as your checklist — search for `<agentname>` in all four files (3 scripts + service unit) before moving on.

### Step 4 — Create the systemd unit

Copy `scripts/listener.service` to `/etc/systemd/system/<agentname>-listener.service`.
Adjust `WorkingDirectory`, `ExecStart`, and `SyslogIdentifier`.

```bash
systemctl daemon-reload
systemctl enable <agentname>-listener
```

### Step 5 — First QR pairing (SSH terminal only — not via the agent itself)

**Why SSH only:** the QR code is rendered as ASCII in stdout. If you trigger pairing through an agent — the OpenClaw agent itself, an automation script, or any chat-based interface that captures stdout — the QR ends up escaped, truncated, or rendered in a context the user can't scan from. Always do this from a real interactive SSH terminal where the ASCII renders cleanly.

```bash
systemctl stop <agentname>-listener   # if running
cd /root/<agentname>/whatsapp
node listener.js                      # QR appears in terminal
# On dedicated phone: WhatsApp → Linked Devices → Link a Device → scan QR
# Wait for: "[OK] WhatsApp connected and ready!"
# Then: Ctrl+C
systemctl start <agentname>-listener
```

### Step 6 — Add credentials & LLM config to `/run/openclaw-env`

Use one of the three configurations above. Load via `load-env.py` + 1Password (or whatever mechanism the OpenClaw stack uses for this VPS).

The systemd unit reads it via `EnvironmentFile=/run/openclaw-env` — **this line is critical**. Without it, none of the `LLM_*` vars reach the Python process and the bot falls back to a static error message. Forty minutes debugging the LLM thinking it's broken (production-lessons §2).

### Step 7 — Smoke test

Run the bundled script:

```bash
bash /root/<agentname>/whatsapp/smoke-test.sh <agentname>
```

It runs four automated checks (service active, ready/error log scan, API key in service env, queue not stuck) and exits non-zero on failure. Then the manual final step:

```
Send a real WhatsApp message to the dedicated number.
Expected: response in 15–25s, coherent with SYSTEM_PROMPT.
```

Only after the script exits clean **and** the manual message round-trip works: announce the bot as live.

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

## Emergency Procedures

See `references/emergency-procedures.md`.

## NEVER do

- `openclaw channels login --account <agentname>` while listener is running — destroys the session (the OpenClaw native channel and wwebjs both try to claim the same WhatsApp Web slot)
- Run `node listener.js` manually in parallel to systemd service — locks the session
- Use a personal number — anyone opening WhatsApp on the physical phone disconnects the linked device and breaks the bot. The dedicated SIM/eSIM rule exists for this exact reason (see production-lessons §6)
- Hardcode provider slugs or keys in `api-handler.py` — everything goes through `/run/openclaw-env`
- Paste terminal outputs containing API keys into chat — they live in `/run/openclaw-env` only, loaded via `load-env.py`

---

**Version 1.0.0** · See [CHANGELOG.md](./CHANGELOG.md) for history. Human-facing overview in [README.md](./README.md).
