import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PoteController } from './pote.controller';
import { PoteService } from './pote.service';

@Module({
  controllers: [PoteController],
  providers: [PoteService, PrismaService],
})
export class PoteModule {}
