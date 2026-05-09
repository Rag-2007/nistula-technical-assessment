import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhookDto } from './dto/webhook.dto';

@Controller('webhook')
export class WebhooksController {
  constructor(public webhookservice: WebhooksService) {}

  @Post('/message')
  @HttpCode(HttpStatus.OK)
  async handleGuestMessage(@Body() msg: WebhookDto) {
    return await this.webhookservice.SendMsgToAI(msg);
  }
}
