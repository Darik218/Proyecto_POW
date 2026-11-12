import { jest } from '@jest/globals';
import { AutomaticProgressionService } from './automatic-progression.service';
import type { ProgressionRepository } from './progression.repository';
describe('automatic internal processor lifecycle', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = original;
    jest.useRealTimers();
  });
  it('is disabled by default and cannot be activated by merely creating the service', async () => {
    delete process.env.PULSO_AUTOMATION_ENABLED;
    jest.useFakeTimers();
    const processActiveAutomatic = jest.fn();
    const service = new AutomaticProgressionService({
      processActiveAutomatic,
    } as unknown as ProgressionRepository);
    service.onModuleInit();
    jest.advanceTimersByTime(120000);
    expect(processActiveAutomatic).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });
  it('runs bounded periodic work without overlap, drains shutdown and prevents later ticks', async () => {
    process.env = {
      ...original,
      PULSO_AUTOMATION_ENABLED: 'true',
      PULSO_AUTOMATION_INTERVAL_MS: '1000',
      PULSO_AUTOMATION_BATCH_SIZE: '3',
    };
    jest.useFakeTimers();
    let finish!: (n: number) => void;
    const processActiveAutomatic = jest.fn(
      () =>
        new Promise<number>((r) => {
          finish = r;
        }),
    );
    const service = new AutomaticProgressionService({
      processActiveAutomatic,
    } as unknown as ProgressionRepository);
    service.onModuleInit();
    jest.advanceTimersByTime(3000);
    expect(processActiveAutomatic).toHaveBeenCalledTimes(1);
    expect(processActiveAutomatic.mock.calls[0]).toHaveLength(2);
    let stopped = false;
    const shutdown = service.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish(1);
    await shutdown;
    await service.tick();
    jest.advanceTimersByTime(5000);
    expect(processActiveAutomatic).toHaveBeenCalledTimes(1);
  });
  it('accepts another tick after transient failure without logging credentials', async () => {
    const processActiveAutomatic = jest
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('private'))
      .mockResolvedValueOnce(2);
    const service = new AutomaticProgressionService({
      processActiveAutomatic,
    } as unknown as ProgressionRepository);
    expect(await service.tick()).toBeUndefined();
    expect(await service.tick()).toBe(2);
    await service.onModuleDestroy();
  });
});
