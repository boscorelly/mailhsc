# Changelog

All notable changes to MailHSC are documented in this file.

## [1.2.1] - 2026-05-28

### Added
- Application version displayed in the footer, served via `/api/version` endpoint (injected at build time via `-ldflags`)

### Security
- `/api/version` restricted to `GET` requests only (was accepting all HTTP methods)
- `/api/version` now behind a rate-limited Traefik router (10 req/s per IP)

### Fixed
- `auth.np` guarded against `undefined` — prevents crash on cached pre-1.2.0 responses
- `resp.Body` explicitly closed in health probe before `os.Exit`
- `sniStrict` production recommendation documented in `.env.example`

### Removed
- All remaining references to former project name (MailLens) in `.env.example` and `LICENSE`
- `LICENSE` copyright updated to MailHSC Contributors

---

## [1.2.0] - 2026-05-27

### Added
- **RFC 9989 / DMARCbis support** — `np=` tag (non-existent subdomain policy) parsed from `Authentication-Results` headers and scored (−10 on fail)
- `NP` displayed in the authentication grid and security score pills
- Authentication result regex extended to `[\w-]{1,32}` — handles `bestguesspass` and any future hyphenated values from RFC 9989

### Translations
- `npPass` / `npFail` added in all 4 languages (EN, FR, DE, ES)

---

## [1.1.0] - 2026-05-20

### Added
- **Standalone mode** — `DEPLOY_MODE=standalone` in `.env` runs the app without Traefik on a configurable port (`STANDALONE_PORT`)
- Auto-detection of `docker compose` (plugin) vs `docker-compose` (standalone)

### Changed
- Static files embedded in the binary via `go:embed` — no filesystem dependency at runtime, eliminates silent COPY failures on arm64/distroless

---

## [1.0.0] - 2026-05-10

### Added
- Email header analysis: SPF, DKIM, DMARC, ARC extraction and scoring
- Security score 0–100 with per-issue breakdown
- Hop-by-hop routing visualization with delay indicators
- Reply-To ≠ From domain detection (phishing indicator)
- Light / dark / auto theme toggle with `localStorage` persistence
- Auto language detection — EN, FR, DE, ES
- "N headers hidden" clickable to expand inline
- Fonts served locally (GDPR compliant — zero external requests)
- Rate limiting per source IP on `/api/analyze` (Traefik)
- Automatic HTTPS via Traefik + Let's Encrypt (TLS-ALPN-01 and DNS-01)
- Docker security hardening: distroless image, non-root user, `read_only`, `cap_drop: ALL`, isolated network
