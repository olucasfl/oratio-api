import { IsIn, IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { COMMITMENT_MAX_LENGTH } from '../domain/catalog';

export class Round1ActionDto {
  @IsInt()
  @Min(0)
  index: number;

  @IsIn(['TAKE', 'PASS'])
  action: 'TAKE' | 'PASS';
}

export class ItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  itemId: string;
}

export class CommitmentDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Escreva o seu compromisso' })
  @MaxLength(COMMITMENT_MAX_LENGTH)
  text: string;
}
