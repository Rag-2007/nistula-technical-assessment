import { IsEnum,IsISO8601,IsNotEmpty,IsOptional,IsString,IsUUID,Matches }from 'class-validator';
import { MessageSource } from './meesage-source.enum';
import { QueryType } from './query-type.enum';

export class UnifiedMessageDto {
  @IsUUID()
  message_id!: string;

  @IsEnum(MessageSource, {message: 'Invalid source platform'})
  source!: MessageSource;

  @IsString()
  @IsNotEmpty()
  guest_name!: string;

  @IsString()
  @IsNotEmpty()
  message_text!: string;

  @IsISO8601({}, {
    message: 'timestamp must be a valid ISO 8601 date',
  })
  timestamp!: string;

  @IsOptional()
  @IsString()
  @Matches(/^NIS-\d{4}-\d{4}$/, {message: 'Invalid booking reference format'})
  booking_ref?: string;

  @IsString()
  @IsNotEmpty()
  property_id!: string;

  @IsEnum(QueryType,{message: 'Invalid query type'})
  query_type!: QueryType;
}