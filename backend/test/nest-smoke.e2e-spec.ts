import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

@Controller('health')
class SmokeController {
  @Get()
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({ controllers: [SmokeController] })
class SmokeModule {}

describe('Nest E2E test runtime', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SmokeModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts Nest and initializes its HTTP adapter', () => {
    expect(app.getHttpServer()).toBeDefined();
    expect(app.getHttpAdapter().getInstance()).toBeDefined();
  });
});
