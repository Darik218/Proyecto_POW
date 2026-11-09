import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { OneRmService } from './one-rm.service';
import { PROGRESSION_REPOSITORY } from './progression.repository';
import { PrismaProgressionRepository } from './prisma-progression.repository';
import { PerformanceService } from './performance.service';

@Module({
  imports: [PrismaModule],
  providers: [
    OneRmService,
    PerformanceService,
    { provide: PROGRESSION_REPOSITORY, useClass: PrismaProgressionRepository },
  ],
  exports: [OneRmService, PerformanceService],
})
export class ProgressionModule {}
