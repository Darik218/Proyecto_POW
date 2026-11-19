import { jest } from '@jest/globals';
import { Decimal } from '@prisma/client/runtime/client';
import { AthletesPresenter } from '../src/views/athletes/athletes.presenter';
import { Athlete } from '../src/models/athletes/athlete.model';
import { BodyMeasurement } from '../src/models/athletes/body-measurement.model';
import {
  isolated,
  mvcHarness,
  vueHttp,
  type MvcHarness,
  type Actor,
} from './helpers/mvc6';

isolated('MVC-6 athletes with real PostgreSQL', () => {
  let h: MvcHarness, owner: Actor, other: Actor;
  beforeAll(async () => {
    h = await mvcHarness();
    owner = await h.actor();
    other = await h.actor();
  });
  afterAll(async () => {
    await h?.app.close();
  });

  it('resolves the registered user profile through the domain model and exact public view', async () => {
    const presenter = h.app.get(AthletesPresenter);
    const spy = jest.spyOn(presenter, 'profile');
    try {
      const result = await h.get('/athletes/me', owner).expect(200);
      const row = await h.prisma.athlete.findUniqueOrThrow({
        where: { userId: owner.id },
      });
      expect(result.body).toEqual({
        id: owner.athleteId,
        birthDate: null,
        preferredUnit: 'KG',
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
      expect(spy.mock.calls[0]![0]).toBeInstanceOf(Athlete);
      expect(result.body.userId).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('updates only supplied fields, preserves units/dates and supports clearing birthDate', async () => {
    const before = await h.get('/athletes/me', owner).expect(200);
    const first = await h
      .send('patch', '/athletes/me', { birthDate: '1995-06-15' }, owner)
      .expect(200);
    expect(first.body.birthDate).toBe('1995-06-15T00:00:00.000Z');
    expect(first.body.preferredUnit).toBe('KG');
    const unit = await h
      .send('patch', '/athletes/me', { preferredUnit: 'LB' }, owner)
      .expect(200);
    expect(unit.body.birthDate).toBe(first.body.birthDate);
    expect(unit.body.createdAt).toBe(before.body.createdAt);
    const cleared = await h
      .send('patch', '/athletes/me', { birthDate: null }, owner)
      .expect(200);
    expect(cleared.body.birthDate).toBeNull();
    expect(cleared.body.preferredUnit).toBe('LB');
    expect(
      (await h.get('/athletes/me', other).expect(200)).body.preferredUnit,
    ).toBe('KG');
  });

  it('retains Decimal in the model, presents a JSON number and preserves the unlabelled stored measurement', async () => {
    const presenter = h.app.get(AthletesPresenter);
    const spy = jest.spyOn(presenter, 'measurement');
    try {
      const result = await h
        .send(
          'post',
          '/athletes/me/measurements',
          { bodyWeight: 72.125, measuredAt: '2026-02-01T04:30:00.789-05:00' },
          owner,
        )
        .expect(201);
      const model = spy.mock.calls[0]![0];
      expect(model).toBeInstanceOf(BodyMeasurement);
      expect(Decimal.isDecimal(model.attributes.bodyWeight)).toBe(true);
      expect(model.attributes.bodyWeight.toString()).toBe('72.125');
      expect(result.body).toEqual({
        id: result.body.id,
        bodyWeight: 72.125,
        measuredAt: '2026-02-01T09:30:00.789Z',
        notes: null,
      });
      const row = await h.prisma.bodyMeasurement.findUniqueOrThrow({
        where: { id: result.body.id },
      });
      expect(row.athleteId).toBe(owner.athleteId);
      expect(row.bodyWeight.toString()).toBe('72.125');
      expect(result.body).not.toHaveProperty('unit');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps prior measurements, orders by date/id and isolates another athlete including empty history', async () => {
    expect(
      (await h.get('/athletes/me/measurements', other).expect(200)).body,
    ).toEqual([]);
    const before = await h.get('/athletes/me/measurements', owner).expect(200);
    const date = '2026-03-01';
    const first = await h
      .send(
        'post',
        '/athletes/me/measurements',
        { bodyWeight: 70.001, measuredAt: date, notes: '' },
        owner,
      )
      .expect(201);
    const second = await h
      .send(
        'post',
        '/athletes/me/measurements',
        { bodyWeight: 69.999, measuredAt: date, notes: 'Nueva' },
        owner,
      )
      .expect(201);
    const rows = await h.get('/athletes/me/measurements', owner).expect(200);
    const expectedIds = [
      first.body.id as string,
      second.body.id as string,
    ].sort((a, b) => b.localeCompare(a));
    expect(rows.body.slice(0, 2).map((row: { id: string }) => row.id)).toEqual(
      expectedIds,
    );
    expect(rows.body).toHaveLength(before.body.length + 2);
    for (const original of before.body)
      expect(rows.body).toContainEqual(original);
    expect(
      (await h.get('/athletes/me/measurements', other).expect(200)).body,
    ).toEqual([]);
    await h
      .send(
        'post',
        '/athletes/me/measurements',
        { athleteId: other.athleteId, bodyWeight: 75, measuredAt: date },
        owner,
      )
      .expect(400);
    await h.get('/athletes/' + other.athleteId, owner).expect(404);
    await h
      .send('patch', '/athletes/me', { userId: other.id }, owner)
      .expect(400);
  });

  it('rejects invalid values, unknown fields and unauthenticated operations without writing', async () => {
    const count = await h.prisma.bodyMeasurement.count({
      where: { athleteId: owner.athleteId },
    });
    for (const extra of [
      { bodyWeight: 0 },
      { bodyWeight: 10000 },
      { bodyWeight: 72.1234 },
      { measuredAt: '2026-02-30' },
      { notes: 'x'.repeat(1001) },
      { id: owner.athleteId },
    ]) {
      await h
        .send(
          'post',
          '/athletes/me/measurements',
          { bodyWeight: 75, measuredAt: '2026-01-01', ...extra },
          owner,
        )
        .expect(400);
    }
    for (const body of [
      {},
      { birthDate: 'invalid' },
      { preferredUnit: 'OTHER' },
      { preferredUnit: null },
      { id: owner.athleteId },
    ])
      await h.send('patch', '/athletes/me', body, owner).expect(400);
    expect(
      await h.prisma.bodyMeasurement.count({
        where: { athleteId: owner.athleteId },
      }),
    ).toBe(count);
    await h.get('/athletes/me').expect(401);
    await h.get('/athletes/me/measurements').expect(401);
    await h
      .http()
      .patch('/api/v1/athletes/me')
      .send({ preferredUnit: 'KG' })
      .expect(401);
    await h
      .http()
      .post('/api/v1/athletes/me/measurements')
      .send({ bodyWeight: 75, measuredAt: '2026-01-01' })
      .expect(401);
  });

  it('returns controlled 404 for a test account with a missing profile without creating one silently', async () => {
    const missing = await h.actor();
    await h.prisma.athlete.delete({
      where: { id: missing.athleteId, userId: missing.id },
    });
    await h.get('/athletes/me', missing).expect(404);
    await h
      .send('patch', '/athletes/me', { preferredUnit: 'LB' }, missing)
      .expect(404);
    await h.get('/athletes/me/measurements', missing).expect(404);
    await h
      .send(
        'post',
        '/athletes/me/measurements',
        { bodyWeight: 75, measuredAt: '2026-01-01' },
        missing,
      )
      .expect(404);
    expect(
      await h.prisma.athlete.count({ where: { userId: missing.id } }),
    ).toBe(0);
  });

  it('uses the real Vue Axios/Zod athlete service against HTTP and PostgreSQL', async () => {
    const output = await vueHttp(
      h.app,
      `
      import assert from 'node:assert/strict';
      import {api} from './src/services/api.ts';
      import {athletesService} from './src/services/athletes.service.ts';
      let raw='';for await(const part of process.stdin)raw+=part;
      const {baseURL,token,id}=JSON.parse(raw);api.defaults.baseURL=baseURL;api.defaults.headers.common.Authorization='Bearer '+token;
      assert.equal((await athletesService.getProfile()).id,id);
      assert.equal((await athletesService.updateProfile({preferredUnit:'KG'})).preferredUnit,'KG');
      const measurement=await athletesService.addMeasurement({bodyWeight:71.123,measuredAt:'2026-04-01'});
      assert.equal(measurement.bodyWeight,71.123);assert.equal(measurement.notes,null);
      assert.equal((await athletesService.getMeasurements())[0].id,measurement.id);
      console.log('Athletes Vue PostgreSQL passed');
    `,
      { token: owner.token, id: owner.athleteId },
    );
    expect(output).toContain('Athletes Vue PostgreSQL passed');
  });
});
