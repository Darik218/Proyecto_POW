import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AthletesController } from '../controllers/athletes/athletes.controller';
import { AthletesPresenter } from '../views/athletes/athletes.presenter';
import { ATHLETES_REPOSITORY } from './athletes.repository';
import { AthletesService } from './athletes.service';
import { PrismaAthletesRepository } from './prisma-athletes.repository';

@Module({
  imports: [AuthModule],
  controllers: [AthletesController],
  providers: [
    AthletesService,
    AthletesPresenter,
    { provide: ATHLETES_REPOSITORY, useClass: PrismaAthletesRepository },
  ],
  exports: [AthletesService],
})
export class AthletesModule {}
