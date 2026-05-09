import { Injectable } from '@nestjs/common';
import { WebhookDto } from './dto/webhook.dto';
import { UnifiedMessageDto } from './dto/unifiedmsg.dto';
import { QueryType } from './dto/query-type.enum';
import { AiService } from '../ai/ai.service';
import { randomUUID } from 'node:crypto';
import { AIResponseDTO } from './dto/ai-response.dto';

const CLASSIFICATION_RULES: {
  type: QueryType;
  patterns: Array<{ term: string; weight: number }>;
}[] = [
  {
    type: QueryType.COMPLAINT,
    patterns: [
      { term: 'not working', weight: 10 },
      { term: 'not happy', weight: 10 },
      { term: 'not satisfied', weight: 10 },
      { term: 'unacceptable', weight: 9 },
      { term: 'disgusting', weight: 9 },
      { term: 'terrible', weight: 8 },
      { term: 'horrible', weight: 8 },
      { term: 'refund', weight: 8 },
      { term: 'complaint', weight: 8 },
      { term: 'complain', weight: 8 },
      { term: 'broken', weight: 7 },
      { term: 'dirty', weight: 7 },
      { term: 'worst', weight: 7 },
      { term: 'unhappy', weight: 7 },
      { term: 'issue', weight: 5 },
      { term: 'problem', weight: 5 },
      { term: 'bad', weight: 6 },
    ],
  },
  {
    type: QueryType.PRE_SALES_AVAILABILITY,
    patterns: [
      { term: 'available from', weight: 10 },
      { term: 'available on', weight: 10 },
      { term: 'availability', weight: 9 },
      { term: 'available', weight: 8 },
      { term: 'any dates', weight: 7 },
      { term: 'open dates', weight: 7 },
      { term: 'book', weight: 2 },
      { term: 'booking', weight: 2 },
      { term: 'stay', weight: 2 },
      { term: 'dates', weight: 4 },
    ],
  },
  {
    type: QueryType.PRE_SALES_PRICING,
    patterns: [
      { term: 'what is the rate', weight: 10 },
      { term: 'how much', weight: 9 },
      { term: 'cost per night', weight: 9 },
      { term: 'pricing', weight: 8 },
      { term: 'price', weight: 7 },
      { term: 'rate', weight: 7 },
      { term: 'charges', weight: 7 },
      { term: 'cost', weight: 6 },
      { term: 'per night', weight: 6 },
      { term: 'nights', weight: 5 },
      { term: 'night', weight: 4 },
      { term: 'adults', weight: 4 },
      { term: 'adult', weight: 3 },
      { term: 'guests', weight: 3 },
      { term: 'guest', weight: 3 },
    ],
  },
  {
    type: QueryType.POST_SALES_CHECKIN,
    patterns: [
      { term: 'check-in time', weight: 10 },
      { term: 'check in time', weight: 10 },
      { term: 'check-out time', weight: 10 },
      { term: 'check out time', weight: 10 },
      { term: 'wifi password', weight: 10 },
      { term: 'wi-fi password', weight: 10 },
      { term: 'wifi', weight: 8 },
      { term: 'password', weight: 8 },
      { term: 'check-in', weight: 7 },
      { term: 'check in', weight: 7 },
      { term: 'check-out', weight: 7 },
      { term: 'checkout', weight: 7 },
      { term: 'arrival', weight: 6 },
      { term: 'departure', weight: 6 },
    ],
  },
  {
    type: QueryType.SPECIAL_REQUEST,
    patterns: [
      { term: 'early check-in', weight: 10 },
      { term: 'early check in', weight: 10 },
      { term: 'late check-out', weight: 10 },
      { term: 'late checkout', weight: 10 },
      { term: 'airport transfer', weight: 10 },
      { term: 'airport pickup', weight: 10 },
      { term: 'book the chef', weight: 10 },
      { term: 'birthday decoration', weight: 9 },
      { term: 'anniversary', weight: 8 },
      { term: 'chef', weight: 8 },         
      { term: 'pickup', weight: 6 },
      { term: 'transfer', weight: 6 },
      { term: 'cab', weight: 6 },
      { term: 'arrangement', weight: 6 },
      { term: 'birthday', weight: 5 },
      { term: 'special', weight: 4 },
      { term: 'early', weight: 6 },
      { term: 'coming early', weight: 9 },
      { term: 'late', weight: 3 },
    ],
  },
  {
    type: QueryType.GENERAL_ENQUIRY,
    patterns: [
      { term: 'do you allow', weight: 8 },
      { term: 'is there parking', weight: 8 },
      { term: 'pet', weight: 7 },
      { term: 'pets', weight: 7 },
      { term: 'parking', weight: 6 },
      { term: 'pool', weight: 7 },         
      { term: 'pool timings', weight: 9 },
      { term: 'amenities', weight: 5 },
      { term: 'location', weight: 4 },
      { term: 'distance', weight: 4 },
      { term: 'facilities', weight: 4 },
      { term: 'smoking', weight: 5 },
      { term: 'barbeque', weight: 5 },
      { term: 'bbq', weight: 5 },
      { term: 'service', weight: 6 },
      { term: 'services', weight: 6 },
      { term: 'service available', weight: 12 },
      { term: 'services available', weight: 12 },
      { term: 'amenities available', weight: 12 },
      { term: 'chef service', weight: 8 },
    ],
  },
];

@Injectable()
export class WebhooksService {
  constructor(public aiservice: AiService) {}

  classifyQuery(message: string): QueryType {
    const text = message.toLowerCase();
    const scores = new Map<QueryType, number>();

    for (const rule of CLASSIFICATION_RULES) {
      let score = 0;
      for (const { term, weight } of rule.patterns) {
        if (text.includes(term)) {
          score += weight;
        }
      }
      if (score > 0) {
        scores.set(rule.type, score);
      }
    }

    if (scores.size === 0) {
      return QueryType.GENERAL_ENQUIRY;
    }
    let bestType = QueryType.GENERAL_ENQUIRY;
    let bestScore = -1;

    for (const [type, score] of scores) {
      if (
        score > bestScore ||
        (score === bestScore && type === QueryType.COMPLAINT)
      ) {
        bestScore = score;
        bestType = type;
      }
    }
    return bestType;
  }

  normalise(msg: WebhookDto): UnifiedMessageDto {
    return {
      message_id: randomUUID(),
      source: msg.source,
      guest_name: msg.guest_name,
      message_text: msg.message,
      timestamp: msg.timestamp,
      booking_ref: msg.booking_ref,
      property_id: msg.property_id,
      query_type: this.classifyQuery(msg.message),
    };
  }

  async SendMsgToAI(msg: WebhookDto): Promise<AIResponseDTO> {
    const unifiedMsg = this.normalise(msg);
    return await this.aiservice.InteractWithAI(unifiedMsg);
  }
}
