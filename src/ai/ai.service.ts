import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { UnifiedMessageDto } from '../webhooks/dto/unifiedmsg.dto';
import { AIResponseDTO } from '../webhooks/dto/ai-response.dto';
import { ActionType } from '../webhooks/dto/action.enum';
import { QueryType } from '../webhooks/dto/query-type.enum';

const PROPERTY_CONTEXT = `
Property: Villa B1, Assagao, North Goa
Bedrooms: 3 | Max guests: 6 | Private pool: Yes
Check-in: 2pm | Check-out: 11am
Base rate: INR 18,000 per night (up to 4 guests)
Extra guest: INR 2,000 per night per person
WiFi password: Nistula@2024
Caretaker: Available 8am to 10pm
Chef on call: Yes, pre-booking required
Availability April 20-24: Available
Cancellation policy: Free cancellation up to 7 days before check-in
`.trim();

const BASE_SCORE: Record<QueryType, number> = {
  [QueryType.PRE_SALES_AVAILABILITY]: 0.95,
  [QueryType.PRE_SALES_PRICING]:      0.95,
  [QueryType.POST_SALES_CHECKIN]:     0.92,
  [QueryType.GENERAL_ENQUIRY]:        0.90,
  [QueryType.SPECIAL_REQUEST]:        0.75,
  [QueryType.COMPLAINT]:              0.40,
};

const PRE_SALES_TYPES = new Set<QueryType>([
  QueryType.PRE_SALES_AVAILABILITY,
  QueryType.PRE_SALES_PRICING,
  QueryType.GENERAL_ENQUIRY,
]);

function computeConfidence(msg: UnifiedMessageDto): number {
  if (msg.property_id?.toLowerCase() !== 'villa-b1') {
    return 0.0;
  }

  const base = BASE_SCORE[msg.query_type];
  let contextFactor: number;
  if (msg.booking_ref) {
    contextFactor = 1.0;
  } else if (PRE_SALES_TYPES.has(msg.query_type)) {
    contextFactor = 0.95; 
  } else {
    contextFactor = 0.75; 
  }

  const len = msg.message_text.length;
  const lengthFactor = len < 15 ? 0.75 : len < 20 ? 0.90 : 1.0;
  const channelFactor = msg.source === 'instagram' ? 0.95 : 1.0;
  const raw = base * contextFactor * lengthFactor * channelFactor;
  return Math.min(Math.round(raw * 100) / 100, 1.0);
}

function resolveAction(score: number, queryType: QueryType): ActionType {
  if (score === 0.0) return ActionType.ESCALATE;
  if (queryType === QueryType.COMPLAINT) return ActionType.ESCALATE;
  if (score >= 0.85) return ActionType.AUTO_SEND;
  if (score >= 0.60 || queryType === QueryType.SPECIAL_REQUEST) {
    return ActionType.AGENT_REVIEW;
  }
  return ActionType.ESCALATE;
}

function buildSystemPrompt(): string {
  return `You are a professional guest-relations assistant for Nistula Villas, a premium luxury villa rental company in Goa, India.

Your role is to draft warm, helpful, and concise replies to guest messages on behalf of the Nistula team.

PROPERTY INFORMATION (use only the data below — do not invent facts):
${PROPERTY_CONTEXT}

TONE GUIDELINES:
- Warm and welcoming, never robotic
- Address the guest by first name
- Keep replies under 120 words unless complex pricing requires detail
- Use INR (₹) for monetary values
- For complaints: acknowledge the issue empathetically, apologise, and assure follow-up — do NOT auto-resolve
- End every reply with a friendly closing line`;
}

function buildUserPrompt(msg: UnifiedMessageDto): string {
  const booking = msg.booking_ref
    ? `Booking reference: ${msg.booking_ref}`
    : 'No booking reference (pre-booking enquiry)';

  return `Guest message received via ${msg.source.toUpperCase()}
Guest name: ${msg.guest_name}
${booking}
Property: ${msg.property_id}
Query category: ${msg.query_type.replace(/_/g, ' ')}
Timestamp: ${msg.timestamp}

Message:
"${msg.message_text}"

Draft a reply to this guest message based on the property information provided. Reply only with the message text — no metadata, no labels, no preamble.`;
}


@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY is not set — AI calls will fail. Add it to your .env file.',
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async InteractWithAI(msg: UnifiedMessageDto): Promise<AIResponseDTO> {
    const confidence = computeConfidence(msg);
    const action = resolveAction(confidence, msg.query_type);

    if (msg.property_id?.toLowerCase() !== 'villa-b1') {
      return {
        message_id: msg.message_id,
        query_type: msg.query_type,
        confidence_score: 0.0,
        action: ActionType.ESCALATE,
        drafted_reply: "SYSTEM: Unsupported property ID. AI reply generation is bound to Mock context of villa-b1."
      };
    }

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildUserPrompt(msg) }],
      });

      const firstBlock = response.content[0];
      const draftedReply =
        firstBlock.type === 'text' && firstBlock.text.trim()
          ? firstBlock.text.trim()
          : 'We have received your message and will get back to you shortly.';

      return {
        message_id: msg.message_id,
        query_type: msg.query_type,
        drafted_reply: draftedReply,
        confidence_score: confidence,
        action,
      };
    } catch (error) {
      this.logger.error('Claude API call failed', error);
      throw new InternalServerErrorException(
        'Failed to generate a reply. Please try again.',
      );
    }
  }
}
