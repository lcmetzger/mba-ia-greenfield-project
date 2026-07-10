import { ArrayMinSize, ArrayNotEmpty, IsInt, Max, Min } from 'class-validator';

export class UploadPartsDto {
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10000, { each: true })
  part_numbers: number[];
}
