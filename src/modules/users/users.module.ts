import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { MailService } from '../mail/mail.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, MailModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService, MailService],
})
export class UsersModule {}
