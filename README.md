# whatsapp-agent-setup

> Connect a dedicated WhatsApp number to an OpenClaw agent — without going through Meta's Business API.

```
 _                            _   _                  _            _
(_)_ __  _ __   _____   ____ _| |_(_) ___  _ __    __| | ___   ___| |_ ___  _ __
| | '_ \| '_ \ / _ \ \ / / _` | __| |/ _ \| '_ \  / _` |/ _ \ / __| __/ _ \| '__|
| | | | | | | | (_) \ V / (_| | |_| | (_) | | | || (_| | (_) | (__| || (_) | |
|_|_| |_|_| |_|\___/ \_/ \__,_|\__|_|\___/|_| |_(_)__,_|\___/ \___|\__\___/|_|

   @innovation.doctor  ·  OpenClaw stack
```

**Version:** 1.2.0 · **Status:** Production-validated since 2026-04-30

---

## What this is

A Claude skill that scaffolds a complete WhatsApp ↔ LLM bridge on an Ubuntu VPS using `whatsapp-web.js` (Puppeteer). Wires a dedicated WhatsApp number to any OpenAI-compatible LLM endpoint, with channel security flags and execution hardening for production deployments.

**Latency:** 15–25 seconds end-to-end.
**LLM layer:** provider-agnostic (OpenRouter, OpenAI, Anthropic, Together, Groq, local vLLM/Ollama).
**Channel security:** group-blocking by default, optional contact allowlist, optional read-only mode.
**Execution hardening (v1.2.0+):** dedicated service user, pinned dependencies, file permissions `0600`, log rotation.

## What it is not

A solution for high-volume customer support, multi-attendant routing, or anything that needs Meta's official WhatsApp Business API badge. Read `## When NOT to use this skill` in `SKILL.md` before deploying.

## Architecture

```
User (WhatsApp)
  → listener.js        [filter chain → dedup → typing indicator → triggers processor]
  → processor.js       [reads queue, calls Python, writes response]
  → api-handler.py     [LLM call — provider-agnostic, OpenAI-compatible]
  → listener.js        [5s loop → sends response]
```

Filter chain order: `fromMe` → groups → broadcast → allowlist → dedup. Blocked messages drop before any LLM cost is incurred.

## File layout

```
whatsapp-agent-setup/
├── SKILL.md                          # Claude's instructions
├── README.md                         # This file
├── CHANGELOG.md                      # Version history
├── package.json                      # Pinned Node deps (v1.2.0+)
├── requirements.txt                  # Pinned Python deps (v1.2.0+)
├── scripts/
│   ├── listener.js                   # WhatsApp listener with filter chain
│   ├── processor.js                  # Queue processor with atomic writes
│   ├── api-handler.py                # LLM handler (provider-agnostic)
│   ├── listener.service              # systemd unit with memory caps + hardening
│   ├── smoke-test.sh                 # 5 automated checks + manual prompt
│   ├── install-service-user.sh       # Migration to dedicated user (v1.2.0+)
│   └── secure-permissions.sh         # Permissions + logrotate (v1.2.0+)
└── references/
    ├── production-lessons.md         # 9 documented failures + fixes
    └── emergency-procedures.md       # Incident playbook
```

## Hardening profiles

Pick one **before** running through the workflow:

| Profile | User | Paths | Deps | Perms | Logrotate |
|---------|------|-------|------|-------|-----------|
| **Lab** | `root` | `/root/` | unpinned | default | none |
| **Production-internal** *(recommended)* | `openclaw-wa` | `/opt/` + `/var/lib/` | pinned | `0700`/`0600` | yes |
| **Production-public** | same as production-internal + mandatory allowlist + `READ_ONLY=true` + external approval skill |

Production profiles are reached by running `install-service-user.sh` then `secure-permissions.sh` after the initial Lab-profile install. SKILL.md `## Hardening profile` has the full table and rationale.

## Deployment profiles (channel security)

Orthogonal to hardening. Configure via `/run/openclaw-env`:

| Profile | `ALLOW_GROUPS` | `ALLOWED_CONTACTS` | `READ_ONLY` | Use case |
|---------|---------------|--------------------|-------------|----------|
| Internal/closed | `false` | empty | `false` | Known commodity domain, predictable contacts |
| Fase 1 — observe before responding | `false` | small allowlist | `true` | New deployment, learning the traffic |
| Multi-role public + approval | `false` | strict allowlist | `true` | Pair with separate approval skill |
| Group assistant (rare) | `true` | strict allowlist | `false` | Bot in known groups only |

## Quick start

For Lab profile:

```bash
mkdir -p /root/<agentname>/whatsapp /root/<agentname>/queue
cd /root/<agentname>/whatsapp
cp /path/to/skill/{package.json,requirements.txt} .
npm install
pip3 install -r requirements.txt
# Copy and customize scripts/, install systemd unit, pair via SSH, configure /run/openclaw-env
bash smoke-test.sh <agentname>
```

For Production-internal: same as Lab, then:

```bash
sudo bash install-service-user.sh <agentname>
sudo bash secure-permissions.sh <agentname>
bash smoke-test.sh <agentname>
```

Full step-by-step in `SKILL.md`.

## Production track record

- Live since 2026-04-30 in a closed internal deployment.
- 9 issues documented and fixed in `references/production-lessons.md` (memory leak, missing API key, slow responses, double responses, session corruption, fallback chain failure, JSON corruption, dependency drift, plaintext queue exposure)

## Compatibility

- Ubuntu 22.04+, **min 4 GB RAM**
- Node.js 18+, Python 3, pip
- Any OpenAI-compatible LLM endpoint
- OpenClaw stack (for credential loading via `load-env.py` + 1Password)

## License & ownership

Built by Doc / @innovation.doctor.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
