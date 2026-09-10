import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Req,
  UseGuards,
  Headers,
  UnauthorizedException,
  Param,
  Query,
} from '@nestjs/common';

import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from 'src/modules/auth/admin.guard';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';

@Controller('users')
export class UsersController {

  constructor(private readonly userService: UsersService) {}

  /*
  =============================
  CREATE USER
  =============================
  */

  @Post()
  create(@Body() body: CreateUserDto, @Headers('x-app') app?: string) {
    return this.userService.create(body, app);
  }

  /*
  =============================
  GET PROFILE
  =============================
  */

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(@Req() req: any) {

    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.getProfile(userId);
  }

  /*
  Guia de boas-vindas concluído. Mesma pilha do GET /users/me (só
  JwtAuthGuard) — chamada única por conta, sem throttle dedicado e sem X-App,
  igual ao `POST oratio/voxai/profile/intro-seen`. `userId` vem do token,
  nunca do corpo (RULES §5). Sem corpo. Resposta: { ok: true }.
  */
  @Post('me/welcome-seen')
  @UseGuards(JwtAuthGuard)
  markWelcomeSeen(@Req() req: any) {

    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.markWelcomeSeen(userId);
  }

  @Get('admin/users')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getAllUsers(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('isAdmin') isAdmin?: string,
    @Query('emailVerified') emailVerified?: string,
    @Query('activeLastDays') activeLastDays?: string,
  ) {
    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const filters = {
      search: search || undefined,
      isAdmin: isAdmin === 'true' ? true : isAdmin === 'false' ? false : undefined,
      emailVerified: emailVerified === 'true' ? true : emailVerified === 'false' ? false : undefined,
      activeLastDays: activeLastDays ? parseInt(activeLastDays) : undefined,
    };

    return this.userService.getAllUsers(userId, filters);
  }

  @Get('admin/users/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getUserDetail(@Req() req: any, @Param('id') userId: string) {
    const adminId = req?.user?.userId;

    if (!adminId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.getUserDetail(adminId, userId);
  }

  @Delete('admin/users/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  deleteUser(@Req() req: any, @Param('id') userId: string) {
    const adminId = req?.user?.userId;

    if (!adminId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.deleteUserAdmin(adminId, userId);
  }


  @Get('admin/stats')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getAdminStats(@Req() req: any) {
    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.getAdminStats(userId);
  }

  @Get('admin/stats/timeseries')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, AdminGuard, ThrottlerGuard)
  getAdminTimeseries(
    @Req() req: any,
    @Query('metric') metric?: string,
    @Query('range') range?: string,
  ) {
    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.getAdminTimeseries(
      userId,
      metric || 'users',
      range || '6m',
    );
  }

  @Get('admin/stats/heatmap')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, AdminGuard, ThrottlerGuard)
  getActivityHeatmap(
    @Req() req: any,
    @Query('metric') metric?: string,
    @Query('days') days?: string,
  ) {
    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.getActivityHeatmap(
      userId,
      metric || 'logins',
      days ? parseInt(days) : 90,
    );
  }

  /*
  Rate limit: sem isso, um admin comprometido podia tentar ADMIN_PASSWORD
  sem limite nenhum de tentativas.
  */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Patch('admin/users/:id')
  @UseGuards(JwtAuthGuard, AdminGuard, ThrottlerGuard)
  setAdminStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { isAdmin: boolean; adminPassword: string },
  ) {
    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.setAdminStatus(
      userId,
      id,
      body.isAdmin,
      body.adminPassword
    );
  }

  @Get('admin/users/:id/activity')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getUserActivity(@Req() req: any, @Param('id') userId: string) {
    const adminId = req?.user?.userId;

    if (!adminId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.getUserActivity(adminId, userId);
  }

  /*
  =============================
  UPDATE PROFILE
  =============================
  */

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateProfile(
    @Req() req: any,
    @Body() body: { name: string },
  ) {

    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.updateProfile(
      userId,
      body.name,
    );
  }

  /*
  =============================
  CHANGE PASSWORD
  =============================
  */

  /*
  Rate limit: sem isso, alguém com um access token válido (roubado ou
  de sessão comprometida) podia tentar `currentPassword` infinitas
  vezes até acertar por força bruta.
  */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Post('me/change-password')
  changePassword(
    @Req() req: any,
    @Body() body: ChangePasswordDto,
  ) {

    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.changePassword(
      userId,
      body.currentPassword,
      body.newPassword,
    );
  }

  /*
  Definir a primeira senha (conta que entrou só por Google). Mesma pilha de
  guard/throttle do change-password. `x-app` não é exigido (o change-password
  também não exige).
  */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Post('me/set-password')
  setPassword(
    @Req() req: any,
    @Body() body: SetPasswordDto,
  ) {

    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.setPassword(
      userId,
      body.password,
      body.confirmPassword,
    );
  }

  /*
  =============================
  CHANGE EMAIL (2 passos)
  =============================
  */

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Post('me/email')
  requestEmailChange(
    @Req() req: any,
    @Body() body: ChangeEmailDto,
    @Headers('x-app') app?: string,
  ) {

    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.requestEmailChange(userId, body.email, app);
  }

  @Post('me/email/cancel')
  @UseGuards(JwtAuthGuard)
  cancelEmailChange(@Req() req: any) {

    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.cancelEmailChange(userId);
  }

  /*
  =============================
  SESSÕES ATIVAS (dispositivos)
  =============================
  */

  @Get('me/sessions')
  @UseGuards(JwtAuthGuard)
  getMySessions(@Req() req: any) {

    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.getMySessions(userId);
  }

  @Delete('me/sessions/:id')
  @UseGuards(JwtAuthGuard)
  revokeMySession(@Req() req: any, @Param('id') sessionId: string) {

    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.revokeMySession(userId, sessionId);
  }

  /*
  =============================
  DELETE ACCOUNT
  =============================
  */

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Delete('me')
  deleteAccount(@Req() req: any, @Body() body: DeleteAccountDto) {

    const userId = req?.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return this.userService.deleteAccount(userId, {
      password: body.password,
      googleCredential: body.googleCredential,
    });
  }

}