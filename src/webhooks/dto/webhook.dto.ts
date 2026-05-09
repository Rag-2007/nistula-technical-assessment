import { IsString , IsEnum , IsISO8601 , IsNotEmpty , IsOptional } from 'class-validator';
import { MessageSource } from './meesage-source.enum';


export class WebhookDto {
  @IsEnum(MessageSource, {
    message: 'Invalid source platform',
  })
  source!: MessageSource;

  @IsString()
  @IsNotEmpty()
  guest_name!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsISO8601({}, {
    message: 'timestamp must be a valid ISO 8601 date',
  })
  timestamp!: string;

  @IsString()
  @IsOptional()
  booking_ref?: string;

  @IsString()
  @IsNotEmpty()
  property_id!: string;
}