import { IsUUID,IsString,IsNumber,Min,Max,IsEnum }from 'class-validator';
import { QueryType } from './query-type.enum';
import { ActionType } from './action.enum';

export class AIResponseDTO {

  @IsUUID()
  message_id!: string;

  @IsEnum(QueryType)
  query_type!: QueryType;

  @IsString()
  drafted_reply!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1)
  confidence_score!: number;

  @IsEnum(ActionType)
  action!: ActionType;
}