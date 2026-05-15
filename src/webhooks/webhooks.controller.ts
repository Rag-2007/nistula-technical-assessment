import { Controller, Post, Body, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { WebhooksService } from './webhooks.service';
import { WebhookDto } from './dto/webhook.dto';

@Controller('webhook')
export class WebhooksController {
  constructor(public webhookservice: WebhooksService) {}

  @SkipThrottle({ short: true })
  @Get('/health')
  @HttpCode(HttpStatus.OK)
  healthCheck() {
    return {
      status: 'ok',
      service: 'nistula-webhook',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('/message')
  @HttpCode(HttpStatus.OK)
  async handleGuestMessage(@Body() msg: WebhookDto) {
    return await this.webhookservice.SendMsgToAI(msg);
  }
}
