import {
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class InitiateUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  content_type: string;

  @IsInt()
  @Min(1)
  size_bytes: number;

  @IsString()
  @IsNotEmpty()
  original_filename: string;
}
