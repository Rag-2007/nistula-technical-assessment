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

```text
                        ┌─────────────────────────────────────────┐
                        │            DOCKER NETWORK               │
                        │                                         │
 ┌──────────┐  :80      │  ┌───────────────────────────────────┐  │
 │  Client  │──────────►│  │    Nginx Reverse Proxy / LB       │  │
 └──────────┘           │  │   (Rate Limit: 30 rps, burst 10)  │  │
                        │  └─────────────┬─────────────────────┘  │
                        │                │ least_conn             │
                        │        ┌───────┴───────┐                │
                        │        ▼               ▼                │
                        │   ┌─────────┐     ┌─────────┐           │
                        │   │  app1   │     │  app2   │           │
                        │   │ :3000   │     │ :3000   │           │
                        │   │NestJS   │     │NestJS   │           │
                        │   │Throttle │     │Throttle │           │
                        │   │20rpm/IP │     │20rpm/IP │           │
                        │   └─────────┘     └─────────┘           │
                        └─────────────────────────────────────────┘
```

**Infrastructure Components:**

- **Dockerized Microservice Architecture:** Runs inside an isolated, non-root Docker network. Ultra-lean multi-stage Alpine images ensure maximum security and scalable horizontal deployment without exposing environment secrets.
- **Nginx Edge Load Balancer:** Functions as the resilient public gateway on port `80`. It routes traffic dynamically to the least busy NestJS container (`least_conn`) and monitors upstream health to provide zero-downtime availability.
- **Dual-Layer Rate Limiting (Defense-in-Depth):**
  - **Edge (Nginx):** Thwarts volumetric attacks (DDoS) immediately by capping clients at 30 req/sec.
  - **App (NestJS):** The `@nestjs/throttler` guarantees API fairness, capping unique IPs to 20 requests per minute with built-in exemptions for system health checks.

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

## 3. Cross-Module Workflow & Scalability

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

## 4. Query Classification Logic

Instead of relying on brittle, exact-match string comparisons, the system uses a **weighted multi-signal scoring algorithm** to accurately determine guest intent.

**How the logic evaluates messages:**
1. **Keyword Weighting:** Each intent category (e.g., `COMPLAINT`, `PRE_SALES_PRICING`) is mapped to a dictionary of trigger words. Every word is assigned a numerical weight based on its significance (e.g., "broken" = 7 pts, "refund" = 8 pts).
2. **Cumulative Scoring:** The system parses the inbound message and tallies up the score for every matched keyword across all categories simultaneously.
3. **Classification Selection:** The category that accumulates the highest total score is declared the winner.
4. **Safety Tie-Breaker:** If two categories end up with the exact same score, the system automatically defaults to `COMPLAINT`. This guarantees that potentially urgent issues are never missed or misclassified as general inquiries.

---

## 5. Confidence Scoring Engine

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

## 6. Claude AI Integration

The `AiService` uses **`claude-sonnet-4-20250514`** (Anthropic SDK).

**Prompt Engineering:**
- System prompt injects the property's static data sheet — Claude only uses factual data.
- Enforces tone rules (warm, first-name basis, ≤ 120 words).
- Complaints: empathy + follow-up promise — never direct resolution or refund.
- User prompt injects message, channel, booking reference, and classified intent category.

---

## 7. Example Payload & Response

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

## 8. Validation & Error Handling

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

