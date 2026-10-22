import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../auth/auth.types';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { AthletesService } from './athletes.service';
import { CreateMeasurementDto } from './dto/create-measurement.dto';
import { UpdateAthleteDto } from './dto/update-athlete.dto';

@Controller('athletes/me')
@UseGuards(AccessTokenGuard)
export class AthletesController {
  constructor(private readonly athletesService: AthletesService) {}

  @Get()
  getMyProfile(@CurrentAuth() identity: AuthenticatedIdentity) {
    return this.athletesService.getMyProfile(identity);
  }

  @Patch()
  updateMyProfile(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() body: UpdateAthleteDto,
  ) {
    return this.athletesService.updateMyProfile(identity, body);
  }

  @Get('measurements')
  getMyMeasurements(@CurrentAuth() identity: AuthenticatedIdentity) {
    return this.athletesService.getMyMeasurements(identity);
  }

  @Post('measurements')
  addMyMeasurement(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() body: CreateMeasurementDto,
  ) {
    return this.athletesService.addMyMeasurement(identity, body);
  }
}
