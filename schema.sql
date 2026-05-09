-- =========================================================
-- ENUM TYPES
-- =========================================================

CREATE TYPE message_source AS ENUM (
    'whatsapp',
    'booking_com',
    'airbnb',
    'instagram',
    'direct'
);

CREATE TYPE reservation_status AS ENUM (
    'pending',
    'confirmed',
    'cancelled',
    'completed'
);

CREATE TYPE conversation_status AS ENUM (
    'active',
    'closed',
    'escalated'
);

CREATE TYPE sender_type AS ENUM (
    'guest',   
    'ai',      
    'agent',   
    'system' 
);

CREATE TYPE message_direction AS ENUM (
    'inbound', 
    'outbound'  
);

CREATE TYPE query_type AS ENUM (
    'pre_sales_availability',
    'pre_sales_pricing',
    'post_sales_checkin',
    'special_request',
    'complaint',
    'general_enquiry'
);

CREATE TYPE action_type AS ENUM (
    'auto_send',    
    'agent_review', 
    'escalate'      
);

CREATE TYPE review_outcome AS ENUM (
    'approved',   
    'edited',    
    'rejected'   
);


-- =========================================================
-- 1. GUESTS
-- =========================================================
-- Unified guest identity across all channels.
-- One guest record regardless of how many channels
-- they contact us through.
-- =========================================================

CREATE TABLE guests (
    guest_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       VARCHAR(255) NOT NULL,
    email           VARCHAR(255),
    phone           VARCHAR(30),
    first_seen_via  message_source,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- 2. PROPERTIES
-- =========================================================
-- Villa/property details used by the AI to generate
-- contextually accurate replies (rates, wifi, policies).
-- =========================================================

CREATE TABLE properties (
    property_id         VARCHAR(100) PRIMARY KEY,
    property_name       VARCHAR(255) NOT NULL,
    location            VARCHAR(255),
    bedrooms            INT,
    max_guests          INT,
    base_rate           NUMERIC(10,2),
    extra_guest_rate    NUMERIC(10,2),
    checkin_time        TIME,
    checkout_time       TIME,
    wifi_password       VARCHAR(255),
    cancellation_policy TEXT,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- 3. AGENTS
-- =========================================================
-- Human support agents who review, edit, or send replies.
-- Placed before messages so the FK reference is valid.
-- =========================================================

CREATE TABLE agents (
    agent_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name   VARCHAR(255) NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    role        VARCHAR(100),             
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- 4. RESERVATIONS
-- =========================================================
-- Booking records linking guests to properties.
-- Source tells us which channel the booking came through.
-- =========================================================

CREATE TABLE reservations (
    reservation_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_ref     VARCHAR(100) UNIQUE NOT NULL,   
    guest_id        UUID NOT NULL,
    property_id     VARCHAR(100) NOT NULL,
    source          message_source NOT NULL,
    checkin_date    DATE,
    checkout_date   DATE,
    adults          INT DEFAULT 1,
    children        INT DEFAULT 0,
    status          reservation_status DEFAULT 'pending',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_reservation_guest
        FOREIGN KEY (guest_id) REFERENCES guests(guest_id),

    CONSTRAINT fk_reservation_property
        FOREIGN KEY (property_id) REFERENCES properties(property_id)
);


-- =========================================================
-- 5. CONVERSATIONS
-- =========================================================
-- A conversation is a thread/session between a guest
-- and the platform on a given channel.
--
-- Design rule: every conversation must have either a
-- reservation_id (post-sales) or a property_id (pre-sales).
-- This guarantees the AI always has context to work with.
-- =========================================================

CREATE TABLE conversations (
    conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_id        UUID NOT NULL,
    reservation_id  UUID,              
    property_id     VARCHAR(100),      
    source          message_source NOT NULL,
    status          conversation_status DEFAULT 'active',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_conversation_context
        CHECK (reservation_id IS NOT NULL OR property_id IS NOT NULL),

    CONSTRAINT fk_conversation_guest
        FOREIGN KEY (guest_id) REFERENCES guests(guest_id),

    CONSTRAINT fk_conversation_reservation
        FOREIGN KEY (reservation_id) REFERENCES reservations(reservation_id),

    CONSTRAINT fk_conversation_property
        FOREIGN KEY (property_id) REFERENCES properties(property_id)
);


-- =========================================================
-- 6. MESSAGES
-- =========================================================
-- Core table. Every inbound and outbound message lives here.
--
-- Lifecycle for an AI-handled inbound message:
--
--   [Guest sends message]
--   → INSERT row: direction='inbound', sender='guest'
--     ai_generated_reply = AI draft text
--     action = 'auto_send' | 'agent_review' | 'escalate'
--     confidence_score = 0.00–1.00
--     query_type = classified type
--
--   [If action = 'auto_send']
--   → INSERT row: direction='outbound', sender='ai'
--     in_reply_to = inbound message_id
--     message_text = the sent reply
--
--   [If action = 'agent_review']
--   → Agent sees ai_generated_reply on the inbound row
--   → Agent approves / edits / rejects  (recorded in agent_reviews)
--   → INSERT row: direction='outbound', sender='agent'
--     in_reply_to = inbound message_id
--     agent_id = who sent it
--     message_text = final sent text
-- =========================================================

CREATE TABLE messages (
    message_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id     UUID NOT NULL,
    in_reply_to         UUID,
    sender              sender_type NOT NULL,
    direction           message_direction NOT NULL,
    source              message_source NOT NULL,
    message_text        TEXT NOT NULL,
    query_type          query_type,        
    confidence_score    NUMERIC(3,2),       
    ai_generated_reply  TEXT,              
    action              action_type,       
    agent_id            UUID,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_confidence_score
        CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0.00 AND 1.00),

    CONSTRAINT chk_agent_required
        CHECK (
            NOT (direction = 'outbound' AND sender = 'agent' AND agent_id IS NULL)
        ),

    CONSTRAINT fk_message_conversation
        FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id),

    CONSTRAINT fk_message_reply_to
        FOREIGN KEY (in_reply_to) REFERENCES messages(message_id),

    CONSTRAINT fk_message_agent
        FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
);


-- =========================================================
-- 7. AGENT REVIEWS
-- =========================================================
-- Records what an agent did with an AI-generated draft.
-- Separated from messages to keep the audit trail clean
-- and to avoid polluting the core message row with
-- review-state columns.
--
-- One row per agent review action.
-- Linked to the INBOUND message that triggered the review.
-- =========================================================

CREATE TABLE agent_reviews (
    review_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id          UUID NOT NULL,
    agent_id            UUID NOT NULL,
    outcome             review_outcome NOT NULL,
    final_reply_text    TEXT,
    edit_notes          TEXT,
    reviewed_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_review_message
        FOREIGN KEY (message_id) REFERENCES messages(message_id),

    CONSTRAINT fk_review_agent
        FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
);


-- =========================================================
-- 8. AI PROCESSING LOGS
-- =========================================================
-- Technical execution metadata per AI call.
-- Separated from messages to:
--   - avoid bloating the core business table
--   - enable independent AI performance analysis
--   - support future multi-model architecture
-- =========================================================

CREATE TABLE ai_processing_logs (
    log_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id          UUID NOT NULL,
    model_name          VARCHAR(100) NOT NULL,   
    prompt_tokens       INT,
    completion_tokens   INT,
    processing_time_ms  INT,
    raw_prompt          TEXT,     
    raw_response        TEXT,   
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_ai_log_message
        FOREIGN KEY (message_id) REFERENCES messages(message_id)
);


-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX idx_reservations_guest_id
    ON reservations(guest_id);

CREATE INDEX idx_conversations_guest_id
    ON conversations(guest_id);

CREATE INDEX idx_messages_conversation_id
    ON messages(conversation_id);

CREATE INDEX idx_messages_in_reply_to
    ON messages(in_reply_to);

CREATE INDEX idx_messages_query_type
    ON messages(query_type);

CREATE INDEX idx_messages_created_at
    ON messages(created_at);

CREATE INDEX idx_messages_agent_id
    ON messages(agent_id);

CREATE INDEX idx_ai_logs_message_id
    ON ai_processing_logs(message_id);

CREATE INDEX idx_agent_reviews_message_id
    ON agent_reviews(message_id);

CREATE INDEX idx_agent_reviews_agent_id
    ON agent_reviews(agent_id);


-- =========================================================
-- DESIGN DECISIONS SUMMARY
-- =========================================================
--
-- 1. LIFECYCLE TRACKING (hardest decision)
--    The AI draft lifecycle is split across two rows:
--    - Inbound row holds ai_generated_reply (the staging draft)
--    - Outbound row holds the actual sent message_text
--    - in_reply_to links outbound → inbound for threading
--    - agent_reviews records approve/edit/reject outcome
--    This avoids mixing guest content with reply content
--    on a single row, while keeping the sent record canonical.
--
-- 2. AGENT ACCOUNTABILITY
--    agent_id is nullable on messages (NULL for AI/system rows)
--    but a CHECK constraint enforces it is set whenever
--    direction='outbound' AND sender='agent'.
--
-- 3. CONVERSATION CONTEXT GUARANTEE
--    CHECK constraint ensures every conversation has either
--    a reservation_id or property_id — so the AI always has
--    a context anchor for reply generation.
--
-- 4. CONFIDENCE SCORE CONSTRAINT
--    NUMERIC(3,2) with CHECK (BETWEEN 0.00 AND 1.00) makes
--    the 0–1 range explicit rather than just conventional.
--
-- 5. AGENTS TABLE MOVED BEFORE MESSAGES
--    Table ordering respects FK dependency chain:
--    guests → agents → properties → reservations
--    → conversations → messages → agent_reviews
--                              → ai_processing_logs
--
-- 6. SEPARATION OF AI LOGS
--    ai_processing_logs is intentionally a satellite table.
--    It can be archived, partitioned, or moved to a separate
--    analytics DB without touching the core schema.
--
-- =========================================================