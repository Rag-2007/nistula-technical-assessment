# Part 3 — Thinking Question

## Question A — The Immediate Response

**Message:**
"Hi [Guest Name], I sincerely apologize for the lack of hot water at Villa B1, especially with guests arriving so soon. I have escalated this as a critical emergency to our on-call maintenance team to resolve before breakfast. Regarding the refund, I have flagged your request for the property manager to review first thing in the morning. We are actively working to fix this immediately."

**Explanation:**
This wording is empathetic and validates their specific time constraints. Crucially, it commits to immediate physical action (maintenance dispatch) to de-escalate panic, while safely deferring the financial demand (refund) to a human manager, protecting business policies.

## Question B — The System Design

1.  **Ingestion & Classification (Trigger):** The WhatsApp webhook payload hits the API gateway. The NLP service analyzes the text, flagging `intent: emergency_maintenance` and `sentiment: critical`, while extracting key entities (`Villa B1`, `issue: hot_water`, `demand: refund`).
2.  **Orchestration & Routing (Notification):** An event-driven message broker (e.g., Kafka/RabbitMQ) routes the payload. The AI service immediately sends the empathetic WhatsApp reply. Concurrently, the ticketing service creates a Sev-1 incident, triggering PagerDuty/SMS alerts to the on-call maintenance technician and alerting the property manager regarding the refund.
3.  **State Management (Logging):** The complete interaction lifecycle—raw webhook JSON, NLP confidence scores, AI response, and dispatch timestamps—is immutably written to the primary database (e.g., PostgreSQL) for operational audit and analytics.
4.  **SLA Enforcement (30-Minute Fallback):** A delayed background job (e.g., via Redis/BullMQ) is initialized upon ticket creation. If the ticket state remains unacknowledged by a human after 30 minutes, a fallback protocol fires, triggering automated Twilio voice calls escalating the issue to the regional operations manager.

## Question C — The Learning

**System Action:**
The platform's analytics engine should cluster historical issue tags. Detecting a recurring `hot_water` intent for `Villa B1` (3 times in 60 days) must automatically trigger a "Chronic Infrastructure Alert" to senior operations, elevating it from a routine fix to a capital repair review.

**Preventative Solution:**
I would build a "Proactive Maintenance & IoT Module" featuring:
1.  **Threshold Enforcement:** A rule engine that automatically flags properties crossing a specific defect threshold, optionally soft-blocking new bookings until a certified inspection is logged.
2.  **IoT Integration:** Integrate smart boiler sensor webhooks. If the system detects a temperature drop below baseline, it automatically dispatches maintenance and pre-emptively messages the guest *before* they notice, shifting the platform from reactive damage control to proactive hospitality.

---

## Additional: Future Production Enhancements
*Beyond this immediate scenario, the platform's architecture would benefit from the following production-grade scaling features:*
*   **Observability & Security:** Implement structured logging, tracing, webhook authentication, and rate limiting.
*   **Asynchronous Processing:** Utilize Redis-based job queues for async AI processing and retry mechanisms.
*   **State & Configuration:** Transition to multi-property dynamic configuration storage and persistent database records for full message histories.
*   **Operations & ML:** Deploy a real-time human escalation dashboard and a fine-tuned ML-based intent classification model to increase routing accuracy.
