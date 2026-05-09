# Nistula Guest Messaging Webhook

A robust, production-grade NestJS backend designed to handle inbound guest messages across multiple channels (WhatsApp, Airbnb, Instagram, Booking.com, Direct). The system normalises messages into a unified schema, performs intelligent intent classification, delegates reply generation to Claude (Anthropic AI), and returns the drafted response alongside a calculated confidence score.

Designed with **MVC architecture** and **modular microservice patterns**, the system ensures maintainability, separation of concerns, and high scalability.

---

## 1. Setup & Installation

Follow these steps to run the application locally:

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
# Create a .env file in the root directory and add:
ANTHROPIC_API_KEY=sk-ant-your-api-key-here
PORT=3000

# 3. Start the development server (clears port 3000 first to prevent EADDRINUSE errors)
lsof -ti :3000 | xargs kill -9 2>/dev/null; npx ts-node-dev --respawn --transpile-only src/main.ts
```

The server will be available at `http://localhost:3000`.

---

## 2. Backend Architecture

This application is built using **NestJS**, adhering to the **Model-View-Controller (MVC)** design pattern within a modular architecture. Rather than a tightly-coupled monolith, the codebase is structured around feature modules, making it trivial to extract components into independent microservices in the future.

### Core Structure

```text
src/
├── main.ts                          # Bootstrap & global configurations
├── app.module.ts                    # Root module integrating sub-modules
├── webhooks/                        # ➔ WEBHOOKS MODULE
│   ├── webhooks.module.ts           # Binds controllers and services
│   ├── webhooks.controller.ts       # (Controller) Handles HTTP requests/routing
│   ├── webhooks.service.ts          # (Service) Data normalisation & classification
│   └── dto/                         # (Data Transfer Objects) Strict typing & validation
│       ├── webhook.dto.ts           # Inbound payload schema
│       └── unifiedmsg.dto.ts        # Internal unified schema
└── ai/                              # ➔ AI MODULE
    ├── ai.module.ts                 
    └── ai.service.ts                # (Service) Claude AI client & confidence logic
```

- **Controllers:** Handle HTTP traffic, delegating business logic immediately to services.
- **Services:** Contain the core business logic (classification, AI interaction).
- **DTOs:** Utilise `class-validator` to strictly type-check inbound JSON payloads to ensure data integrity before any logic runs.

---

## 3. Query Classification Logic

We abandoned brittle "first-match" string checking in favour of a **weighted multi-signal scoring system**. 

### How it works:
1. Every supported query type (`PRE_SALES_AVAILABILITY`, `POST_SALES_CHECKIN`, `SPECIAL_REQUEST`, etc.) contains a dictionary of keywords and phrases.
2. Each keyword is assigned a **weight** based on its importance (e.g., `"not working"` is 10 points for a complaint, while `"book"` is only 2 points for availability).
3. The system scans the message, sums up the matching weights for all categories, and assigns the message to the category with the highest cumulative score.
4. **Tie-Breaking:** If there is a tie, `COMPLAINT` always takes priority to ensure urgent issues are never missed.

---

## 4. Confidence Scoring Engine

Before returning an AI-drafted reply, the system evaluates how trustworthy the AI's response is using a mathematically rigid Confidence Engine.

### The Four Multiplicative Factors
```text
Confidence Score = BASE × CONTEXT × LENGTH × CHANNEL
```

1. **Base Score:** How reliably can the AI answer this query type? (e.g., Pricing = `0.95`, Complaints = `0.40`).
2. **Context Factor:** Does the message have a `booking_ref`? Confirmed guests provide more context (`1.00`). Pre-sales enquiries naturally don't have references, so they are not unfairly penalized (`0.95`).
3. **Length Factor:** Is the message detailed enough? Messages under 15 characters are heavily penalized (`0.75`), while normal conversational queries (≥20 chars) are trusted (`1.00`).
4. **Channel Factor:** Instagram messages are often casual or emoji-heavy, receiving a slight noise penalty (`0.95`). Standard channels like WhatsApp receive `1.00`.

### Strict Safety Floors & Property Validation

To prevent the AI from making unauthorized promises or hallucinating, we implemented hard boundaries:
- **Unknown Properties:** If the inbound `property_id` is anything other than the supported `"villa-b1"`, the system bypasses the API call, drops the confidence score to **`0.0`**, and forces an escalation. The AI will never hallucinate data for an unsupported property.
- **Complaints:** Always force `escalate`, regardless of confidence score.
- **Special Requests:** Always capped at `agent_review`. They will never automatically send, ensuring a human always confirms custom requests like chef bookings or late check-outs.

### Action Thresholds

| Score Range     | Action         | Meaning                                         |
|-----------------|----------------|-------------------------------------------------|
| ≥ 0.85          | `auto_send`    | Highly confident; safe to send to guest         |
| 0.60 – 0.84     | `agent_review` | Moderate confidence; needs human approval       |
| < 0.60          | `escalate`     | Low confidence or safety-flagged; human routing |

---

## 5. Claude AI Integration

The `AiService` integrates directly with the Anthropic API (using `claude-sonnet-4-20250514`). 

**Prompt Engineering:**
The system uses strict contextual framing. The prompt injects the property's static data sheet, ensuring Claude only uses factual data. It enforces tone rules (warm, first-name basis) and length constraints (≤ 120 words). For complaints, the AI is explicitly instructed to show empathy and promise a follow-up, but *never* offer a direct resolution or refund.

---

## Example Payload & Response

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
    "drafted_reply": "Hi Arjun,\n\nI'm so sorry to hear about the AC issue and that you haven't been able to reach anyone for assistance. This is absolutely not the experience we want for you at Villa B1, and I sincerely apologise for the inconvenience.\n\nI'm immediately escalating this to our property management team and caretaker to get the AC fixed as a priority. Someone will be in touch with you within the next 30 minutes to resolve this issue.\n\nThank you for bringing this to our attention, and again, I'm truly sorry for the trouble.\n\nWe'll make sure this gets sorted out right away for you!\n\nWarm regards,\nNistula Villas Team",
    "confidence_score": 0.4,
    "action": "escalate"
}
```

## 6. Validation & Error Handling

The system uses `class-validator` DTO validation to ensure all inbound webhook payloads are structurally correct before processing.
### Examples:
- Invalid source platform → `400 Bad Request`
- Empty message body → `400 Bad Request`
- Unsupported property → graceful escalation flow
- Claude API failure → safe fallback response

This ensures the system remains resilient even under malformed or incomplete requests.

