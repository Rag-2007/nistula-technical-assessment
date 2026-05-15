# Nistula Guest Messaging Webhook

A robust, production-grade **NestJS** backend designed to handle inbound guest messages across multiple channels (WhatsApp, Airbnb, Instagram, Booking.com, Direct). The system normalises messages into a unified schema, performs intelligent intent classification, delegates reply generation to Claude (Anthropic AI), and returns the drafted response alongside a calculated confidence score.

Designed with **MVC architecture**, **modular microservice patterns**, **Dockerized multi-replica deployment**, and **dual-layer rate limiting** for true production-readiness.

---

## 1. Quick Start

### Option A — Docker 

> Requires Docker & Docker Compose installed.

```bash
# 1. Clone the repository and enter the directory
git clone <repo-url>
cd nistula-technical-assessment

# 2. Ensure your .env file exists with a valid API key
#    (the .env is already present with a valid key)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxx
PORT=3000

# 3. Build images and start all services (2 app replicas + Nginx)
docker compose up --build -d

# 4. Verify all containers are healthy
docker compose ps
```

The API will be available at **`http://localhost/webhook/message`** (via Nginx on port 80).

### Option B — Local Development

```bash
# Install dependencies
npm install

# Start the development server (auto-restart on file change)
npx ts-node-dev --respawn --transpile-only src/main.ts
```

The server will be available at `http://localhost:3000`.

---

## 2. Backend Architecture

### High-Level Overview

```
                        ┌─────────────────────────────────────────┐
                        │            DOCKER NETWORK               │
                        │                                         │
 ┌──────────┐  :80      │  ┌───────────────────────────────────┐  │
 │  Client  │──────────►│  │    Nginx Reverse Proxy / LB       │  │
 └──────────┘           │  │   (Rate Limit: 30 rps, burst 10)  │  │
                        │  └─────────────┬─────────────────────┘  │
                        │               │ least_conn              │
                        │       ┌───────┴───────┐                 │
                        │       ▼               ▼                 │
                        │  ┌─────────┐    ┌─────────┐            │
                        │  │  app1   │    │  app2   │            │
                        │  │ :3000   │    │ :3000   │            │
                        │  │NestJS   │    │NestJS   │            │
                        │  │Throttle │    │Throttle │            │
                        │  │20rpm/IP │    │20rpm/IP │            │
                        │  └─────────┘    └─────────┘            │
                        └─────────────────────────────────────────┘
```

### Source Code Structure

```
src/
├── main.ts                          # Bootstrap & global ValidationPipe
├── app.module.ts                    # Root module — ThrottlerModule + WebhooksModule + AiModule
├── webhooks/                        # ➔ WEBHOOKS MODULE
│   ├── webhooks.module.ts           # Binds controller and service
│   ├── webhooks.controller.ts       # HTTP routing (POST /message, GET /health)
│   ├── webhooks.service.ts          # Normalisation & weighted classification engine
│   └── dto/                         # Strict typing & validation
│       ├── webhook.dto.ts           # Inbound payload schema
│       ├── unifiedmsg.dto.ts        # Internal unified schema
│       ├── ai-response.dto.ts       # Outbound response schema
│       ├── query-type.enum.ts       # Intent categories
│       ├── action.enum.ts           # auto_send | agent_review | escalate
│       └── meesage-source.enum.ts   # Supported channels
└── ai/                              # ➔ AI MODULE
    ├── ai.module.ts
    └── ai.service.ts                # Claude API client, confidence scoring, action resolution
```

### Infrastructure Files

```
nistula-technical-assessment/
├── Dockerfile             # Multi-stage build (builder → runner, non-root user)
├── docker-compose.yml     # Orchestrates app1 + app2 + nginx
├── .dockerignore          # Excludes secrets, test files, git history from image
└── nginx/
    └── nginx.conf         # Upstream, rate limit zone, proxy config
```

---

## 3. Dockerization

### Multi-Stage Dockerfile

| Stage | Base Image | Purpose |
|---|---|---|
| **builder** | `node:22-alpine` | Install all deps, compile TypeScript → `dist/` |
| **runner** | `node:22-alpine` | Install only production deps, copy `dist/`, run as non-root |

Key security practices:
- Non-root user (`nistula`) runs the process.
- `ANTHROPIC_API_KEY` is **never baked into the image** — injected at `docker compose up` from `.env`.
- `HEALTHCHECK` built into the Dockerfile pings `/webhook/health` every 30s.

### Scaling Horizontally

To add more replicas beyond the default 2:

```bash
# Run with 4 replicas (remove container_name from compose to allow scaling)
docker compose up --scale app1=4 -d
```

Or simply duplicate the `app3`, `app4` service blocks in `docker-compose.yml` and add them to the Nginx upstream.

---

## 4. Load Balancer (Nginx)

Nginx runs as the **sole public-facing entry point** on port `80`, protecting the NestJS apps from being directly exposed.

| Setting | Value |
|---|---|
| **Strategy** | `least_conn` — routes to the replica with fewest active connections |
| **Keepalive** | 32 persistent connections to each upstream |
| **Timeouts** | Read 30s, Connect 5s |
| **Security headers** | `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection` |
| **Forwarded headers** | `X-Real-IP`, `X-Forwarded-For` passed to NestJS |
| **Health endpoint** | `GET /webhook/health` — bypasses rate limit, used by Nginx upstream checks |

---

## 5. Rate Limiting (Dual-Layer)

The system enforces rate limits at **two independent layers** for defence in depth:

### Layer 1 — Nginx (Network Edge)

```nginx
limit_req_zone $binary_remote_addr zone=webhook_limit:10m rate=30r/s;
limit_req zone=webhook_limit burst=10 nodelay;
```

| Setting | Value |
|---|---|
| **Rate** | 30 requests/second per client IP |
| **Burst** | 10 extra requests processed immediately before 429 is returned |
| **HTTP status on reject** | `429 Too Many Requests` |
| **Scope** | All `/webhook/` routes (health endpoint exempt) |

### Layer 2 — NestJS ThrottlerModule (Application Layer)

```typescript
ThrottlerModule.forRoot([{ name: 'short', ttl: 60000, limit: 20 }])
```

| Setting | Value |
|---|---|
| **Rate** | 20 requests per 60-second window per client IP |
| **HTTP status on reject** | `429 Too Many Requests` |
| **Scope** | All controllers globally (health endpoint decorated with `@SkipThrottle()`) |
| **Guard** | `APP_GUARD` — applied before any controller logic runs |

### Why Two Layers?

- Nginx catches volumetric abuse (DDoS, scrapers) before it reaches Node.js.
- NestJS Throttler handles per-user API fairness in a way that Nginx cannot (e.g. future auth-based quotas).

---

## 6. Cross-Module Workflow & Scalability

### Full Request Lifecycle

```
 1. CLIENT sends POST /webhook/message
         │
         ▼
 2. NGINX (port 80)
    - Applies rate limit zone (30 rps / IP, burst 10)
    - If limit exceeded → 429 immediately (Node.js never touched)
    - Selects least-loaded replica via least_conn
    - Forwards request with X-Real-IP, X-Forwarded-For headers
         │
         ▼
 3. NESTJS APP (app1 or app2, port 3000)
    │
    ├─ [ThrottlerGuard] Checks per-IP request count in memory window
    │   - If limit exceeded (>20/min) → 429 before controller reached
    │
    ├─ [ValidationPipe] Deserialises body into WebhookDto
    │   - Validates: source enum, non-empty strings, ISO8601 timestamp
    │   - If invalid → 400 Bad Request with field-level errors
    │
    └─ [WebhooksController] POST /webhook/message handler
              │
              ▼
 4. WebhooksService.normalise()
    - Generates UUID message_id
    - Maps inbound DTO → UnifiedMessageDto
    - Calls classifyQuery() → Weighted scoring across 6 intent categories
    - Returns QueryType with highest cumulative score
    - Tie → COMPLAINT wins (safety-first)
              │
              ▼
 5. AiService.InteractWithAI()
    │
    ├─ computeConfidence()
    │   - property_id !== 'villa-b1' → 0.0 (short-circuit)
    │   - BASE score × CONTEXT factor × LENGTH factor × CHANNEL factor
    │   - Returns final float [0.0, 1.0]
    │
    ├─ resolveAction()
    │   - score 0.0       → ESCALATE
    │   - COMPLAINT       → ESCALATE (always)
    │   - score ≥ 0.85    → AUTO_SEND
    │   - score ≥ 0.60    → AGENT_REVIEW
    │   - SPECIAL_REQUEST → capped at AGENT_REVIEW
    │   - score < 0.60    → ESCALATE
    │
    └─ Anthropic Claude API call
        - Strict system prompt with property data sheet
        - Draft ≤ 120 words, warm tone, factual only
        - On API failure → InternalServerErrorException (safe fallback)
              │
              ▼
 6. Response returned to client
    {
      message_id, query_type, drafted_reply,
      confidence_score, action
    }
```

### Scalability Properties

| Concern | Implementation |
|---|---|
| **Horizontal scaling** | Stateless NestJS instances — add replicas without code changes |
| **No shared state** | Each replica independently validates, classifies, and calls Anthropic |
| **Load distribution** | Nginx `least_conn` prevents hot-spotting under uneven load |
| **Rate limiting state** | Nginx zone in shared memory (across workers); NestJS in-process per replica |
| **Fault tolerance** | Docker `restart: unless-stopped`; Nginx waits for healthy replicas before starting |
| **Container security** | Non-root process; API keys injected via env, never in image layers |
| **Future DB/cache** | Redis can replace NestJS in-memory throttler for cross-replica consistency |

---

## 7. Query Classification Logic

A **weighted multi-signal scoring system** — not brittle first-match string checking.

1. Every intent category (`PRE_SALES_AVAILABILITY`, `COMPLAINT`, `SPECIAL_REQUEST`, etc.) has a dictionary of terms with assigned weights.
2. The system scans the message text (lowercased), sums matching weights for all categories.
3. The category with the **highest cumulative score** wins.
4. **Tie-breaking:** `COMPLAINT` always wins to ensure urgent issues are never missed.

---

## 8. Confidence Scoring Engine

```
Confidence = BASE × CONTEXT × LENGTH × CHANNEL
```

| Factor | Description |
|---|---|
| **Base** | Reliability per query type (Pricing=0.95, Complaints=0.40) |
| **Context** | `booking_ref` present? Confirmed guests = 1.0; pre-sales = 0.95; no ref = 0.75 |
| **Length** | Message < 15 chars = 0.75; < 20 chars = 0.90; ≥ 20 chars = 1.0 |
| **Channel** | Instagram casual noise = 0.95; all other channels = 1.0 |

### Action Thresholds

| Score | Action | Meaning |
|---|---|---|
| ≥ 0.85 | `auto_send` | High confidence — safe to send automatically |
| 0.60–0.84 | `agent_review` | Moderate — human approval needed |
| < 0.60 | `escalate` | Low confidence or safety flag — human routing |

### Hard Safety Rules

- **Unknown property_id** → confidence drops to `0.0`, action forced to `escalate`. AI never hallucates data for unsupported properties.
- **`COMPLAINT`** → always `escalate`, regardless of score.
- **`SPECIAL_REQUEST`** → capped at `agent_review`. A human always confirms custom requests.

---

## 9. Claude AI Integration

The `AiService` uses **`claude-sonnet-4-20250514`** (Anthropic SDK).

**Prompt Engineering:**
- System prompt injects the property's static data sheet — Claude only uses factual data.
- Enforces tone rules (warm, first-name basis, ≤ 120 words).
- Complaints: empathy + follow-up promise — never direct resolution or refund.
- User prompt injects message, channel, booking reference, and classified intent category.

---

## 10. Example Payload & Response

### Inbound `POST /webhook/message`

```json
{
  "source": "direct",
  "guest_name": "Arjun Mehta",
  "message": "The AC is not working and nobody is responding. Very disappointed.",
  "timestamp": "2026-05-06T18:45:00Z",
  "booking_ref": "NIS-2024-4455",
  "property_id": "villa-b1"
}
```

### Outbound Response

```json
{
  "message_id": "f5a23a2e-16a7-474c-a7be-217ef2e21ef1",
  "query_type": "complaint",
  "drafted_reply": "Hi Arjun,\n\nI'm so sorry to hear about the AC issue...",
  "confidence_score": 0.4,
  "action": "escalate"
}
```

---

## 11. Validation & Error Handling

| Scenario | Response |
|---|---|
| Invalid `source` platform | `400 Bad Request` |
| Empty `message` body | `400 Bad Request` |
| Non-ISO8601 `timestamp` | `400 Bad Request` |
| Unsupported `property_id` | `200 OK` — `confidence: 0.0, action: escalate` |
| Claude API failure | `500 Internal Server Error` |
| Rate limit exceeded (Nginx) | `429 Too Many Requests` |
| Rate limit exceeded (NestJS) | `429 Too Many Requests` |

---

## 12. Endpoints

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/webhook/message` | Process a guest message | None (rate limited) |
| `GET` | `/webhook/health` | Health check for load balancer | None (throttle exempt) |

---

## 13. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ Yes | Your Anthropic API key for Claude access |
| `PORT` | ❌ No | Port for the NestJS server (default: `3000`) |

For Docker deployments, these are read from the `.env` file in the project root by `docker compose`.
