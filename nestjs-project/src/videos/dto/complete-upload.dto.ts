import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class CompletedPartDto {
  @IsInt()
  @Min(1)
  part_number: number;

  @IsString()
  etag: string;
}

export class CompleteUploadDto {
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts: CompletedPartDto[];
}
