import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from 'src/modules/auth/admin.guard';
import { JwtAuthGuard } from 'src/modules/auth/jwt-auth.guard';
import { CommitmentDto, ItemDto, Round1ActionDto } from './dto/actions.dto';
import { CreateInvitesDto } from './dto/create-invites.dto';
import { PauseDto, PhaseDto } from './dto/phase.dto';
import { PoteService } from './pote.service';

/** O código da sala tem sempre 4 dígitos; qualquer outra coisa é "sala inexistente". */
function code4(code: string): string {
  if (!/^\d{4}$/.test(code)) throw new NotFoundException('Sala não encontrada.');
  return code;
}

// Acesso: criar/conduzir é só do admin (AdminGuard); jogar é de quem foi
// convidado (conferido no service pelo PotePlayer, nunca pelo código).
// `userId` vem sempre do token, nunca do body.
@Controller('oratio/pote')
@UseGuards(JwtAuthGuard)
export class PoteController {
  constructor(private readonly service: PoteService) {}

  // ── admin ──

  @Post('rooms')
  @UseGuards(AdminGuard)
  createRoom(@Req() req: any) {
    return this.service.createRoom(req.user.userId);
  }

  // Declarada antes de `rooms/:code` para "mine" não ser lido como código.
  @Get('rooms/mine')
  @UseGuards(AdminGuard)
  listMine(@Req() req: any) {
    return this.service.listMine(req.user.userId);
  }

  @Get('users/search')
  @UseGuards(AdminGuard)
  searchUsers(@Req() req: any, @Query('q') q: string) {
    return this.service.searchUsers(req.user.userId, q);
  }

  @Post('rooms/:code/invites')
  @UseGuards(AdminGuard)
  invite(@Req() req: any, @Param('code') code: string, @Body() body: CreateInvitesDto) {
    return this.service.invite(code4(code), req.user.userId, body.userIds);
  }

  // ── líder da sala (admin + dono da sala, conferido no service) ──

  @Post('rooms/:code/phase')
  @UseGuards(AdminGuard)
  phase(@Req() req: any, @Param('code') code: string, @Body() body: PhaseDto) {
    return this.service.changePhase(code4(code), req.user.userId, body.to);
  }

  @Post('rooms/:code/pause')
  @UseGuards(AdminGuard)
  pause(@Req() req: any, @Param('code') code: string, @Body() body: PauseDto) {
    return this.service.setPaused(code4(code), req.user.userId, body.paused);
  }

  @Post('rooms/:code/extend')
  @UseGuards(AdminGuard)
  extend(@Req() req: any, @Param('code') code: string) {
    return this.service.extend(code4(code), req.user.userId);
  }

  @Delete('rooms/:code/players/:userId')
  @UseGuards(AdminGuard)
  removePlayer(
    @Req() req: any,
    @Param('code') code: string,
    @Param('userId') userId: string,
  ) {
    return this.service.removePlayer(code4(code), req.user.userId, userId);
  }

  @Post('rooms/:code/cancel')
  @UseGuards(AdminGuard)
  cancel(@Req() req: any, @Param('code') code: string) {
    return this.service.cancel(code4(code), req.user.userId);
  }

  // ── convidado (ou líder, no GET) ──

  @Get('rooms/:code')
  getState(@Req() req: any, @Param('code') code: string, @Query('since') since?: string) {
    const parsed = since !== undefined && since !== '' ? Number(since) : undefined;
    const sinceNum = parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
    return this.service.getState(code4(code), req.user.userId, sinceNum);
  }

  @Post('rooms/:code/join')
  join(@Req() req: any, @Param('code') code: string) {
    return this.service.join(code4(code), req.user.userId);
  }

  @Post('rooms/:code/round1/tutorial-done')
  tutorialDone(@Req() req: any, @Param('code') code: string) {
    return this.service.tutorialDone(code4(code), req.user.userId);
  }

  @Post('rooms/:code/round1/action')
  round1Action(@Req() req: any, @Param('code') code: string, @Body() body: Round1ActionDto) {
    return this.service.round1Action(code4(code), req.user.userId, body.index, body.action);
  }

  @Post('rooms/:code/round2/place')
  round2Place(@Req() req: any, @Param('code') code: string, @Body() body: ItemDto) {
    return this.service.round2Place(code4(code), req.user.userId, body.itemId);
  }

  @Post('rooms/:code/round2/remove')
  round2Remove(@Req() req: any, @Param('code') code: string, @Body() body: ItemDto) {
    return this.service.round2Remove(code4(code), req.user.userId, body.itemId);
  }

  @Post('rooms/:code/round2/finish')
  round2Finish(@Req() req: any, @Param('code') code: string) {
    return this.service.round2Finish(code4(code), req.user.userId);
  }

  @Post('rooms/:code/commitment')
  commitment(@Req() req: any, @Param('code') code: string, @Body() body: CommitmentDto) {
    return this.service.saveCommitment(code4(code), req.user.userId, body.text);
  }
}
