# whatsapp-agent-setup

> Connect a dedicated WhatsApp number to an OpenClaw agent — without going through Meta's Business API.

```
 _                            _   _                  _            _
(_)_ __  _ __   _____   ____ _| |_(_) ___  _ __    __| | ___   ___| |_ ___  _ __
| | '_ \| '_ \ / _ \ \ / / _` | __| |/ _ \| '_ \  / _` |/ _ \ / __| __/ _ \| '__|
| | | | | | | | (_) \ V / (_| | |_| | (_) | | | || (_| | (_) | (__| || (_) | |
|_|_| |_|_| |_|\___/ \_/ \__,_|\__|_|\___/|_| |_(_)__,_|\___/ \___|\__\___/|_|

   @innovation.doctor  ·  Anestech  ·  OpenClaw stack
```

**Version:** 1.0.0 · **Status:** Production · **Reference deployment:** SAAN/Salvy (Anestex), live since 2026-04-30

---

## What this is

A Claude skill that scaffolds a complete WhatsApp ↔ LLM bridge on an Ubuntu VPS using `whatsapp-web.js` (Puppeteer). When invoked, Claude produces a customized listener, processor, LLM handler, systemd unit, and smoke-test for a named agent — wired to any OpenAI-compatible LLM endpoint.

**Latency:** 15–25 seconds end-to-end.
**LLM layer:** provider-agnostic (OpenRouter, OpenAI, Anthropic, Together, Groq, local vLLM/Ollama).

## What it is not

A solution for high-volume customer support, multi-attendant routing, or anything that needs Meta's official WhatsApp Business API badge. Read `## When NOT to use this skill` in `SKILL.md` before deploying.

## Architecture

```
User (WhatsApp)
  → listener.js        [receives, dedupes, typing indicator, triggers processor]
  → processor.js       [reads queue, calls Python, writes response]
  → api-handler.py     [LLM call — provider-agnostic, OpenAI-compatible]
  → listener.js        [5s loop → sends response]
```

## File layout

```
whatsapp-agent-setup/
├── SKILL.md                       # Claude's instructions (workflow, why, when not)
├── README.md                      # This file
├── CHANGELOG.md                   # Version history
├── scripts/
│   ├── listener.js                # WhatsApp listener (Node + wwebjs)
│   ├── processor.js               # Queue processor (Node)
│   ├── api-handler.py             # LLM handler (Python, provider-agnostic)
│   ├── listener.service           # systemd unit with Chrome memory caps
│   └── smoke-test.sh              # End-to-end validation (4 automated checks)
└── references/
    ├── production-lessons.md      # 6 documented failures + fixes from production
    └── emergency-procedures.md    # Incident playbook
```

## Quick start

This is a Claude skill — the intended entry point is invoking Claude with the skill installed and asking it to set up an agent. But for a dry run / inspection:

1. Install dependencies:
   ```bash
   mkdir -p /root/<agentname>/whatsapp /root/<agentname>/queue
   cd /root/<agentname>/whatsapp
   npm init -y && npm install whatsapp-web.js qrcode-terminal
   pip3 install openai
   ```
2. Copy templates from `scripts/`, replace every `<agentname>` placeholder.
3. Configure `/run/openclaw-env` with your LLM provider — see SKILL.md `## Variables to define before starting` for the three canonical configurations.
4. Pair via SSH (QR is ASCII; never trigger pairing through an agent), then `systemctl start <agentname>-listener`.
5. Validate: `bash smoke-test.sh <agentname>`.

Full step-by-step in `SKILL.md`.

## Production track record

- **SAAN/Salvy at Anestex** — live since 2026-04-30
- Initial issues all documented and fixed (see `references/production-lessons.md`):
  - Chrome memory leak → `MemoryMax=2G` + 12h preventive restart
  - Silent LLM failure → `EnvironmentFile=/run/openclaw-env`
  - 3-min latency → direct `triggerProcessor()` instead of timer-only
  - Double responses on restart → 500-ID rolling dedup window
  - Session corruption recovery procedure

## Compatibility

- Ubuntu 22.04+, **min 4 GB RAM**
- Node.js 18+, Python 3, pip
- Any OpenAI-compatible LLM endpoint
- OpenClaw stack (for credential loading via `load-env.py` + 1Password — adapt if using a different secret manager)

## License & ownership

Internal Anestech tooling. Built by Doc / @innovation.doctor.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
