# Changelog

All notable changes to this skill will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-05-06

First packaged release. Reviewed against `skill-creator` best practices.

### Added
- `scripts/smoke-test.sh` — bundled end-to-end validation script (4 automated checks + manual round-trip prompt). Replaces the loose collection of `systemctl`/`journalctl` commands from earlier docs.
- `## Why this skill exists` — explicit rationale (bypass Meta Business API for low-volume / internal / prototype use cases) with declared trade-offs.
- `## When NOT to use this skill` — 4 explicit anti-patterns: high-volume customer support, conflicting wwebjs listener, no dedicated SIM, no LLM provider configured.
- `### Queue files anatomy` — table documenting the 4 JSON files coordinating listener ↔ processor.
- `## Variables to define before starting` — consolidated checklist of all `# CUSTOMIZE` placeholders, split into agent identity/paths and LLM configuration.
- Three reference LLM configurations (OpenRouter, OpenAI, Anthropic) ready to paste into `/run/openclaw-env`.
- `README.md` — human-facing entry point.
- `CHANGELOG.md` — this file.
- `version: 1.0.0` in SKILL.md frontmatter.
- ASCII art `@innovation.doctor` header.

### Changed
- `scripts/api-handler.py` — refactored to be **provider-agnostic**. No hardcoded model slugs or endpoints. All LLM routing driven by env vars (`LLM_BASE_URL`, `LLM_API_KEY_VAR`, `LLM_MODELS`, `LLM_TIMEOUT`, `LLM_MAX_TOKENS`). Works with any OpenAI-compatible endpoint (OpenRouter, OpenAI, Anthropic, Together, Groq, vLLM/local).
- Step 5 (QR pairing) — added *why* SSH-only is mandatory (ASCII rendering).
- Step 6 (credentials) — added *why* `EnvironmentFile` is critical (40-min debug story from production-lessons §2).
- Step 7 (validation) — replaced vague "expect response in 15-25s" with `smoke-test.sh <agentname>` invocation + manual round-trip prompt.
- Description in frontmatter — added 2 PT triggers (`"plugar número no agente"`, `"WhatsApp pra Sidecar/Salvy/SAAN"`) and provider-agnostic claim.
- Production Lessons table — added row for cross-provider fallback (avoid false redundancy of same-vendor stack).
- `NEVER do` — added prohibition against hardcoding provider slugs/keys in `api-handler.py` and pasting API keys into chat.

### Unchanged (deliberately)
- `scripts/listener.js` — production-validated since 2026-04-30; no regression risk taken.
- `scripts/processor.js` — same.
- `scripts/listener.service` — same.
- `references/production-lessons.md` — content is canonical.
- `references/emergency-procedures.md` — content is canonical.

## [0.1.0] — 2026-04-30

Internal prototype. SAAN/Salvy reference implementation goes live in production at Anestex.

### Added
- `scripts/listener.js` — whatsapp-web.js listener with LocalAuth, message dedup, typing indicator, direct processor trigger, 5s outbound loop.
- `scripts/processor.js` — file-queue processor invoking the Python handler.
- `scripts/api-handler.py` — initial OpenRouter handler with hardcoded model fallback chain (`openai/gpt-5.5` → `anthropic/claude-sonnet-4.6`).
- `scripts/listener.service` — systemd unit with Chrome memory caps (`MemoryMax=2G`, `RuntimeMaxSec=43200`) and `EnvironmentFile=/run/openclaw-env`.
- `references/production-lessons.md` — 6 documented production failures and fixes.
- `references/emergency-procedures.md` — incident playbook.
- Initial `SKILL.md` with architecture diagram, 7-step workflow, and NEVER-do list.

[1.0.0]: #100--2026-05-06
[0.1.0]: #010--2026-04-30
