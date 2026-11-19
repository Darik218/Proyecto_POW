import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import type { AuthenticatedIdentity } from '../../auth/auth.types';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AthletesService } from '../../athletes/athletes.service';
import { CreateMeasurementDto } from '../../athletes/dto/create-measurement.dto';
import { UpdateAthleteDto } from '../../athletes/dto/update-athlete.dto';
import { AthletesPresenter } from '../../views/athletes/athletes.presenter';

@Controller('athletes/me')
@UseGuards(AccessTokenGuard)
export class AthletesController {
  constructor(
    private readonly athletesService: AthletesService,
    private readonly presenter: AthletesPresenter,
  ) {}

  @Get()
  async getMyProfile(@CurrentAuth() identity: AuthenticatedIdentity) {
    return this.presenter.profile(
      await this.athletesService.getMyProfile(identity),
    );
  }

  @Patch()
  async updateMyProfile(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() body: UpdateAthleteDto,
  ) {
    return this.presenter.profile(
      await this.athletesService.updateMyProfile(identity, body),
    );
  }

  @Get('measurements')
  async getMyMeasurements(@CurrentAuth() identity: AuthenticatedIdentity) {
    return this.presenter.measurements(
      await this.athletesService.getMyMeasurements(identity),
    );
  }

  @Post('measurements')
  async addMyMeasurement(
    @CurrentAuth() identity: AuthenticatedIdentity,
    @Body() body: CreateMeasurementDto,
  ) {
    return this.presenter.measurement(
      await this.athletesService.addMyMeasurement(identity, body),
    );
  }
}
