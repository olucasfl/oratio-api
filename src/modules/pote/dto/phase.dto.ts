import { IsBoolean, IsIn } from 'class-validator';

export const POTE_PHASES = [
  'LOBBY',
  'ROUND_1',
  'RESULT_1',
  'PARABLE',
  'ROUND_2',
  'FINAL',
  'ENDED',
  'CANCELLED',
] as const;

export class PhaseDto {
  @IsIn(POTE_PHASES)
  to: (typeof POTE_PHASES)[number];
}

export class PauseDto {
  @IsBoolean()
  paused: boolean;
}
