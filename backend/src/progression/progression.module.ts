import { WorkoutGuideController } from '../controllers/progression/workout-guide.controller';
import { WorkoutGuidePresenter } from '../views/progression/workout-guide.presenter';
import { WorkoutGuideService } from './workout-guide.service';
import { WORKOUT_GUIDE_REPOSITORY } from './workout-guide.repository';
import { PrismaWorkoutGuideRepository } from './prisma-workout-guide.repository';
import { AutomaticProgressionController } from '../controllers/progression/automatic-progression.controller';
import { AutomaticProgressionService } from './automatic-progression.service';
import { AutomaticProgressionPresenter } from '../views/progression/automatic-progression.presenter';
import { ProgressionSettingsController } from '../controllers/progression/progression-settings.controller';
import { ProgressionSettingsService } from './progression-settings.service';
import { ProgressionSettingsPresenter } from '../views/progression/progression-settings.presenter';
import { AutomationConsentController } from '../controllers/progression/automation-consent.controller';
import { AutomationConsentPresenter } from '../views/progression/automation-consent.presenter';
import { AuthModule } from '../auth/auth.module';
import { ProgressionController } from '../controllers/progression/progression.controller';
import { ProgressionPresenter } from '../views/progression/progression.presenter';
import {
  ProgressionHttpFilter,
  ProgressionPrivateResponse,
} from './progression-http.boundary';
import { Module } from '@nestjs/common';
import { AutomationConsentService } from './automation-consent.service';
import { PrismaModule } from '../database/prisma.module';
import { OneRmService } from './one-rm.service';
import { PROGRESSION_REPOSITORY } from './progression.repository';
import { PrismaProgressionRepository } from './prisma-progression.repository';
import { RecommendationService } from './recommendation.service';
import { AssessmentService } from './assessment.service';
import { PerformanceService } from './performance.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    WorkoutGuideController,
    AutomaticProgressionController,
    ProgressionController,
    AutomationConsentController,
    ProgressionSettingsController,
  ],
  providers: [
    WorkoutGuideService,
    WorkoutGuidePresenter,
    {
      provide: WORKOUT_GUIDE_REPOSITORY,
      useClass: PrismaWorkoutGuideRepository,
    },
    AutomaticProgressionService,
    AutomaticProgressionPresenter,
    ProgressionSettingsService,
    ProgressionSettingsPresenter,
    AutomationConsentPresenter,
    ProgressionPresenter,
    ProgressionHttpFilter,
    ProgressionPrivateResponse,
    AutomationConsentService,
    OneRmService,
    PerformanceService,
    AssessmentService,
    RecommendationService,
    { provide: PROGRESSION_REPOSITORY, useClass: PrismaProgressionRepository },
  ],
  exports: [
    AutomaticProgressionService,
    ProgressionSettingsService,
    AutomationConsentService,
    OneRmService,
    PerformanceService,
    AssessmentService,
    RecommendationService,
  ],
})
export class ProgressionModule {}
