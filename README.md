# 🔍 MailHSC - Header Security Checker

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Go](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go)](https://golang.org)
[![Traefik](https://img.shields.io/badge/Traefik-v3.6-24A1C1?logo=traefikproxy)](https://traefik.io)
[![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker)](https://docker.com)

> **Rip apart email headers in seconds.** SPF, DKIM, DMARC, ARC, hop-by-hop routing, phishing indicators — all in a clean dark UI. Zero data retained. Ever.

---

## ✨ Features

| | |
|---|---|
| 📋 | Paste raw headers **or** upload a `.eml` file |
| 🛤️ | Hop-by-hop routing visualization with delay indicators |
| 🔐 | SPF / DKIM / DMARC / ARC extraction & scoring |
| 🎯 | Security score (0–100) with actionable breakdown |
| 🎣 | Reply-To ≠ From domain detection (phishing indicator) |
| 🌍 | Auto language detection — 🇬🇧 🇫🇷 🇩🇪 🇪🇸 |
| 🧠 | Everything processed in memory — GC'd after response |
| 🔒 | Fonts served locally — fully GDPR compliant |
| ⚡ | Rate limiting per IP on the analysis endpoint |
| 🚀 | HTTPS via Traefik — self-signed locally, Let's Encrypt in production |

---

## 🚀 Quick Start

```bash
git clone https://github.com/boscorelly/mailhsc.git
cd mailhsc
make up
```

`make up` runs `start.sh` which:
1. Creates `.env` from `.env.example` if it doesn't exist
2. Aborts if `TRAEFIK_ACME_EMAIL` is still the placeholder and `DOMAIN` is not `localhost`
3. Runs `docker compose up -d`

| Mode | URL | Certificate |
|---|---|---|
| **Local dev** | https://localhost | Traefik self-signed (accept browser warning once) |
| **Production** | https://yourdomain.com | Let's Encrypt — automatic |

> Always use `make up`, never `docker compose up -d` directly.

---

## ⚙️ Configuration

Everything lives in `.env` (auto-created from `.env.example` on first `make up`):

### Local dev — nothing to change

```env
DOMAIN=localhost
TRAEFIK_ACME_EMAIL=admin@yourdomain.com
ACME_RESOLVER=          # empty = Traefik self-signed cert
```

### Production

```env
DOMAIN=mail.yourdomain.com
TRAEFIK_ACME_EMAIL=admin@yourdomain.com   # real email for expiry notifications
ACME_RESOLVER=letsencrypt-tls             # TLS-ALPN-01, port 443 must be reachable
```

### Production behind NAT / wildcard cert

```env
DOMAIN=mail.yourdomain.com
TRAEFIK_ACME_EMAIL=admin@yourdomain.com
ACME_RESOLVER=letsencrypt-dns
TRAEFIK_DNS_PROVIDER=ovh
OVH_ENDPOINT=ovh-eu
OVH_APPLICATION_KEY=xxx
OVH_APPLICATION_SECRET=xxx
OVH_CONSUMER_KEY=xxx
```

> **Supported DNS providers:** OVH · Cloudflare · Gandi · Scaleway · Route53 · DigitalOcean · Namecheap
> See `.env.example` for all providers and their required variables.

---

## 🧮 Security Score

The score starts at **100** and points are deducted for each issue detected:

| Condition | Deduction |
|---|---|
| SPF fail / softfail | −25 |
| SPF missing | −15 |
| SPF unknown result | −5 |
| DKIM fail | −25 |
| DKIM missing | −10 |
| DKIM present but unverified | −5 |
| DMARC fail | −20 |
| DMARC missing | −5 |
| ARC fail | −10 |
| Reply-To domain ≠ From domain | −20 |
| Reply-To ≠ From (same domain) | −5 |
| X-Spam-Flag: YES | −20 |

The score is floored at **0** (cannot go negative).

**ARC** (`none`) is neutral — the protocol is optional and not yet widely deployed.  
**Hop delays** > 1 hour are flagged as informational but do not affect the score.

| Score | Interpretation |
|---|---|
| 80–100 | ✅ Healthy |
| 45–79 | ⚠️ Issues to investigate |
| 0–44 | 🚨 High risk |

---

## 🏗️ Architecture

```
                    ┌─────────────────────────────────────┐
  Internet  ──────► │  Traefik :443/:80                   │
                    │  HTTPS · rate limit · sec headers    │
                    └──────────────┬──────────────────────┘
                                   │ internal network
                    ┌──────────────▼──────────────────────┐
                    │  Go app :8080                        │
                    │  parse in memory · no internet       │
                    └──────────────┬──────────────────────┘
                                   │
                              JSON response
                           (nothing retained)
```

---

## 🛡️ Security

| Measure | Detail |
|---|---|
| 📦 Distroless image | No shell, no package manager in final image |
| 👤 Non-root user | UID 65532 (`distroless:nonroot`) |
| 🔒 Read-only filesystem | `read_only: true` |
| ⚔️ No Linux capabilities | `cap_drop: ALL` — Traefik adds only `NET_BIND_SERVICE` |
| 🌐 Isolated network | App container has zero internet access |
| 📏 Body size limit | 5 MB in Go + 6 MB in Traefik |
| 🧱 Security headers | CSP · HSTS · X-Frame-Options · Referrer-Policy |
| 🔐 TLS 1.2+ only | Enforced in `traefik/dynamic.yml` |
| 🚦 Rate limiting | 10 req/s burst 20 on `/api/analyze`, keyed per source IP |
| 🤐 No data logging | Go never logs request bodies or header content |
| 🔤 Local fonts | Zero requests to Google Fonts or any third party |
| 🗝️ Secrets in `.env` | Never hardcoded in `docker-compose.yml` |

### 📌 Image pinning (supply chain)

```bash
./scripts/pin-images.sh   # prints SHA256 digests — pin them in compose + Dockerfile
```

---

## 📄 License

**GNU Affero General Public License v3.0** — see [LICENSE](LICENSE).

If you run a modified version of MailHSC over a network, you must make the complete source code available to the users of that service (AGPL §13).
