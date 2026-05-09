import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { AiService } from '../ai/ai.service';

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, AiService],
})
export class WebhooksModule {}
