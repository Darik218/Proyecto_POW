import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AthletesModule } from './athletes/athletes.module';
import { ExercisesModule } from './exercises/exercises.module';
import { TrainingPlansModule } from './training-plans/training-plans.module';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    AuthModule,
    AthletesModule,
    ExercisesModule,
    TrainingPlansModule,
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'backend',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
