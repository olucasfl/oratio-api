import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { AdminGuard } from './admin.guard';
import { MailModule } from '../mail/mail.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    ConfigModule,

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET_KEY'),
        signOptions: { expiresIn: '15m' },
      }),
    }),

    /*
    Rate limit escopado só nas rotas de auth (aplicado via ThrottlerGuard
    diretamente no AuthController, não como guard global) — evita afetar
    rotas de outros módulos (VoxAI, etc.) que já têm seus próprios
    limites ou nenhum.
    */
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 10,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, AdminGuard],
  exports: [AdminGuard, AuthService],
})
export class AuthModule {}