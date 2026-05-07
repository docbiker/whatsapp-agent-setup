# Changelog

All notable changes to this skill will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-05-06

Execution hardening release. Adds dedicated service user, pinned dependencies, file permissions, and log rotation. Backward-compatible — existing v1.1.0 deployments keep running unchanged; the new hardening is opt-in via setup scripts.

### Added
- **`scripts/install-service-user.sh`** — idempotent migration script. Creates system user `openclaw-wa`, moves `/root/<agentname>/` → `/opt/<agentname>/`, moves auth dir → `/var/lib/<agentname>/whatsapp-auth`, rewrites paths inside scripts via `sed`, updates the systemd unit (`User=openclaw-wa`, new `WorkingDirectory`, new `ExecStart`), reloads and restarts. Keeps `.pre-v1.2.0-migration` backups for rollback. Safe to re-run.
- **`scripts/secure-permissions.sh`** — locks down filesystem permissions (`0700` on dirs, `0600` on queue/auth files) and installs `/etc/logrotate.d/<agentname>` rotating `processed.json` + `read-only-log.json` daily with 7-day retention and gzip compression. Validates the logrotate config with `logrotate -d` before exit.
- **`package.json`** — pinned Node dependencies (`whatsapp-web.js@1.23.0`, `qrcode-terminal@0.12.0`). `npm install` now produces a deterministic `package-lock.json` instead of pulling whatever is current at install time.
- **`requirements.txt`** — pinned Python dependency (`openai==1.54.0`).
- **`## Hardening profile`** section in SKILL.md with three profiles:
  - **Lab** — defaults (root, `/root/`, unpinned), for prototyping.
  - **Production-internal** — closed deployment pattern: `openclaw-wa` user, `/opt/` + `/var/lib/`, pinned deps, `0600` perms, logrotate.
  - **Production-public** — same as production-internal plus mandatory allowlist + `READ_ONLY=true` + external approval workflow.
- **Step 0 (pick a profile)** and **Step 7 (run hardening scripts)** added to the workflow.
- **`## Known limitations`** section in SKILL.md — explicit acknowledgment of trade-offs that are deliberately not fixed (Chromium `--no-sandbox`, plaintext JSON, `whatsapp-web.js` being unofficial). Documents the reasoning so future reviewers don't re-litigate them.
- New rows in Production Lessons table for dependency drift and plaintext queue exposure.

### Changed
- **SKILL.md frontmatter version** bumped to `1.2.0`. Description amended to mention execution hardening.
- **Step 2 (install dependencies)** now uses `npm install` against the bundled `package.json` and `pip3 install -r requirements.txt`, instead of the loose `npm install <packages>` / `pip3 install <packages>` from earlier versions.
- **NEVER do** — added warning against using the Lab profile for production deployments.

### Notes on what was NOT changed
- `listener.js`, `processor.js`, `api-handler.py`, `listener.service`, `smoke-test.sh` — all untouched. The hardening is delivered via setup scripts that mutate paths and the unit file at install time, not via code changes.
- Reference docs (`production-lessons.md`, `emergency-procedures.md`) — unchanged.
- The Lab profile reproduces v1.1.0 behavior exactly. Existing v1.1.0 deployments are not forced to migrate.

### Migration from v1.1.0 to v1.2.0
For existing v1.1.0 deployments, migration is a deliberate operation, not automatic:
1. Pull the new scripts.
2. Run `sudo bash install-service-user.sh <agentname>` — moves files, creates user, rewrites paths, restarts.
3. Run `sudo bash secure-permissions.sh <agentname>` — locks permissions, installs logrotate.
4. Verify with `bash smoke-test.sh <agentname>`.
5. After 24h of clean operation, delete `.pre-v1.2.0-migration` backups.

This is **not** required to keep using the agent. The migration is recommended for production-internal and production-public profiles, optional for Lab.

## [1.1.0] — 2026-05-06

Channel security & robustness hardening release. Fully backward-compatible — defaults preserve v1.0.0 behavior except groups, which are now blocked by default (the previous behavior of accepting group messages was a latent footgun in production).

### Added
- **`ALLOW_GROUPS` env var** (default `false`) — drops messages from `@g.us` JIDs unless explicitly enabled.
- **`ALLOWED_CONTACTS` env var** — CSV of allowed JIDs. When non-empty, anything not in the list is dropped at the listener level with a `[BLOCK]` log line.
- **`READ_ONLY` env var** (default `false`) — when `true`, captured messages are appended to `read-only-log.json` and nothing else happens. Outbound loop disabled. Designed for fase-1 deployment (observe before responding).
- **Atomic file writes** — all queue files now use the write-tmp + rename pattern. A crash mid-write leaves the previous version intact.
- **`read-only-log.json`** — new queue file, rolling 1000 entries.
- **Filter chain logging** — `[BLOCK] from=<jid> reason=<stage>` and `[ACCEPT] from=<jid>` for every inbound. `[BOOT]` at startup reports effective security flags.
- **systemd hardening flags** — `NoNewPrivileges`, `ProtectSystem=full`, `PrivateTmp`, `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectControlGroups`, `RestrictSUIDSGID`, `LockPersonality`. All compatible with `User=root`.
- **Smoke test check #5** — channel security configuration verification.

### Changed
- New section `## Channel security` in SKILL.md.
- Smoke test now runs 5 checks instead of 4.

### Security
- **Group messages blocked by default** (behavior change vs v1.0.0). The previous behavior was a latent risk. Set `ALLOW_GROUPS=true` to restore.
- Filter chain runs before dedup and before LLM call — blocked messages don't consume tokens, don't appear in `processed.json`, don't get a typing indicator.

## [1.0.0] — 2026-05-06

First packaged release. Reviewed against `skill-creator` best practices.

### Added
- `scripts/smoke-test.sh` — bundled end-to-end validation (4 automated checks).
- `## Why this skill exists`, `## When NOT to use this skill`, `### Queue files anatomy`, `## Variables to define before starting` sections.
- Three reference LLM configurations (OpenRouter, OpenAI, Anthropic).
- `README.md`, `CHANGELOG.md`.
- ASCII art `@innovation.doctor` header.

### Changed
- `scripts/api-handler.py` — refactored to be **provider-agnostic**. No hardcoded model slugs or endpoints. Works with any OpenAI-compatible endpoint.

### Unchanged (deliberately)
- `listener.js`, `processor.js`, `listener.service` — production-validated since 2026-04-30.

## [0.1.0] — 2026-04-30

Internal prototype goes live in production as a closed deployment.

### Added
- `listener.js`, `processor.js`, `api-handler.py`, `listener.service`.
- `references/production-lessons.md` (6 documented production failures).
- `references/emergency-procedures.md`.
- Initial `SKILL.md`.

[1.2.0]: #120--2026-05-06
[1.1.0]: #110--2026-05-06
[1.0.0]: #100--2026-05-06
[0.1.0]: #010--2026-04-30
