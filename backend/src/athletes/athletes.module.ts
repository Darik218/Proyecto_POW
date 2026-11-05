import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AthletesController } from './athletes.controller';
import { ATHLETES_REPOSITORY } from './athletes.repository';
import { AthletesService } from './athletes.service';
import { PrismaAthletesRepository } from './prisma-athletes.repository';

@Module({
  imports: [AuthModule],
  controllers: [AthletesController],
  providers: [
    AthletesService,
    { provide: ATHLETES_REPOSITORY, useClass: PrismaAthletesRepository },
  ],
})
export class AthletesModule {}
