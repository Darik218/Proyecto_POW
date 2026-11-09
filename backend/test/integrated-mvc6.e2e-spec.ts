import { randomUUID } from 'node:crypto';
import { ModulesContainer } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { sign } from 'jsonwebtoken';
import { AuthConfig } from '../src/auth/auth.config';
import {
  isolated,
  mvcHarness,
  vueHttp,
  origin,
  type MvcHarness,
  type Actor,
} from './helpers/mvc6';

isolated('MVC-6 integrated functional journeys', () => {
  let h: MvcHarness, owner: Actor, other: Actor;
  let pushExercise: string, pullExercise: string;
  beforeAll(async () => {
    h = await mvcHarness();
    owner = await h.actor();
    other = await h.actor();
    const group = await h.group();
    for (const name of ['Push', 'Pull']) {
      const result = await h
        .send(
          'post',
          '/exercises',
          {
            name: name + ' MVC6',
            equipment: 'Mancuernas',
            equipmentType: 'DUMBBELL',
            primaryMuscleGroupKey: group.key,
          },
          owner,
        )
        .expect(201);
      if (name === 'Push') pushExercise = result.body.id as string;
      else pullExercise = result.body.id as string;
    }
  });
  afterAll(async () => {
    await h?.app.close();
  });
  async function planning() {
    const plan = await h
      .send(
        'post',
        '/training-plans',
        { name: 'Plan integral MVC6', startsOn: '2026-01-01' },
        owner,
      )
      .expect(201);
    const base = '/training-plans/' + plan.body.id;
    const week = await h
      .send('post', base + '/weeks', { weekNumber: 1 }, owner)
      .expect(201);
    const weekBase = `${base}/weeks/${week.body.id}`;
    await h
      .send(
        'post',
        weekBase + '/days',
        { name: 'Push', position: 1, weekday: 1 },
        owner,
      )
      .expect(201);
    const days = await h
      .send(
        'post',
        weekBase + '/days',
        { name: 'Pull', position: 2, weekday: null },
        owner,
      )
      .expect(201);
    const [push, pull] = days.body.weeks[0].days;
    let last;
    for (const [day, exerciseId] of [
      [push, pushExercise],
      [pull, pullExercise],
    ])
      last = await h
        .send(
          'post',
          `${weekBase}/days/${day.id}/exercises`,
          {
            exerciseId,
            position: 1,
            targetSets: 3,
            targetRepsMin: 6,
            targetRepsMax: 8,
            targetLoad: 80.125,
            targetLoadUnit: 'KG',
            targetRpe: 8,
          },
          owner,
        )
        .expect(201);
    return {
      planId: plan.body.id as string,
      weekId: week.body.id as string,
      pushId: push.id as string,
      pullId: pull.id as string,
      base,
      weekBase,
      planning: last!.body,
    };
  }
  const prepare = (
    p: Awaited<ReturnType<typeof planning>>,
    day: string,
    actor = owner,
    extra = {},
  ) =>
    h.send(
      'post',
      '/workout-sessions',
      {
        id: randomUUID(),
        performedOn: '2026-01-05',
        timeZone: 'America/Bogota',
        recordingMode: 'RETROSPECTIVE',
        trainingPlanId: p.planId,
        planWeekId: p.weekId,
        planDayId: day,
        ...extra,
      },
      actor,
    );

  it('resolves real Nest providers and registers all 68 functional routes exactly once', () => {
    const modules = [...h.app.get(ModulesContainer).values()];
    const controllers = modules.flatMap((module) => [
      ...module.controllers.values(),
    ]);
    const routes: string[] = [];
    for (const wrapper of controllers) {
      expect(wrapper.instance).toBeDefined();
      const type = wrapper.metatype!;
      const base = Reflect.getMetadata(PATH_METADATA, type) as string;
      for (const name of Object.getOwnPropertyNames(type.prototype)) {
        const handler = type.prototype[name] as object;
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        routes.push(
          method +
            ' /' +
            base +
            '/' +
            (Reflect.getMetadata(PATH_METADATA, handler) as string),
        );
      }
    }
    expect(controllers).toHaveLength(7);
    expect(routes).toHaveLength(68);
    expect(new Set(routes).size).toBe(68);
    // This harness deliberately excludes AppModule/Observe and the root scaffold route.
  });

  it('A: registration -> identity -> owned profile -> update -> measurement -> history uses real layers', async () => {
    const actor = await h.actor();
    const identity = await h.get('/auth/me', actor).expect(200);
    expect(identity.body.id).toBe(actor.id);
    const profile = await h
      .send(
        'patch',
        '/athletes/me',
        { birthDate: '1990-05-10', preferredUnit: 'LB' },
        actor,
      )
      .expect(200);
    expect(profile.body.id).toBe(actor.athleteId);
    const measurement = await h
      .send(
        'post',
        '/athletes/me/measurements',
        { bodyWeight: 75.123, measuredAt: '2026-01-05' },
        actor,
      )
      .expect(201);
    expect(
      (await h.get('/athletes/me/measurements', actor).expect(200)).body,
    ).toEqual([measurement.body]);
    expect(
      (
        await h.prisma.bodyMeasurement.findUniqueOrThrow({
          where: { id: measurement.body.id },
        })
      ).athleteId,
    ).toBe(actor.athleteId);
  });

  it('B/C: catalog -> plan -> distinct Push/Pull days -> independent sessions -> actual sets -> completed history', async () => {
    const p = await planning();
    const catalog = await h
      .get('/exercises/visible', owner)
      .query({ search: 'Push MVC6' })
      .expect(200);
    expect(catalog.body.items.map((item: { id: string }) => item.id)).toContain(
      pushExercise,
    );
    const push = await prepare(p, p.pushId).expect(201);
    const pull = await prepare(p, p.pullId).expect(201);
    expect(
      push.body.exercises.map(
        (item: { exercise: { id: string } }) => item.exercise.id,
      ),
    ).toEqual([pushExercise]);
    expect(
      pull.body.exercises.map(
        (item: { exercise: { id: string } }) => item.exercise.id,
      ),
    ).toEqual([pullExercise]);
    const base = '/workout-sessions/' + push.body.id;
    const executionId = push.body.exercises[0].id;
    const original = push.body.exercises[0].original;
    expect(original.targets).toMatchObject({
      targetLoad: '80.125',
      targetLoadUnit: 'KG',
      targetRepsMin: 6,
      targetRepsMax: 8,
    });
    const adjusted = await h
      .send(
        'patch',
        `${base}/exercises/${executionId}`,
        {
          expectedVersion: push.body.version,
          targetLoad: '77.5',
          targetLoadUnit: 'KG',
        },
        owner,
      )
      .expect(200);
    expect(adjusted.body.exercises[0].original).toEqual(original);
    const started = await h
      .send(
        'post',
        base + '/start',
        { expectedVersion: adjusted.body.version },
        owner,
      )
      .expect(200);
    let current = started;
    for (const [setNumber, repetitions, load, status] of [
      [1, 8, '77.5', 'COMPLETED'],
      [2, 7, '75.125', 'INCOMPLETE'],
    ] as const) {
      current = await h
        .send(
          'post',
          `${base}/exercises/${executionId}/sets`,
          {
            id: randomUUID(),
            expectedVersion: current.body.version,
            setNumber,
            repetitions,
            load,
            loadUnit: 'KG',
            status,
            kind: 'WORK',
            rpe: 8.5,
          },
          owner,
        )
        .expect(201);
    }
    const complete = await h
      .send(
        'post',
        base + '/complete',
        { expectedVersion: current.body.version },
        owner,
      )
      .expect(200);
    expect(complete.body.status).toBe('COMPLETED');
    const history = await h.get(base, owner).expect(200);
    expect(history.body).toEqual(complete.body);
    expect(history.body.exercises[0].original).toEqual(original);
    expect(history.body.exercises[0].targets.targetLoad).toBe('77.5');
    expect(
      history.body.exercises[0].sets.map(
        (set: { load: string; repetitions: number }) => [
          set.load,
          set.repetitions,
        ],
      ),
    ).toEqual([
      ['77.5', 8],
      ['75.125', 7],
    ]);
    expect(
      await h.prisma.setRecord.count({
        where: { workoutExerciseId: executionId },
      }),
    ).toBe(2);
    expect(
      (
        await h
          .get('/workout-sessions', owner)
          .query({ status: 'COMPLETED', trainingPlanId: p.planId })
          .expect(200)
      ).body.items[0].id,
    ).toBe(push.body.id);
    const recent = await h
      .get('/exercises/visible', owner)
      .query({ selection: 'RECENT' })
      .expect(200);
    expect(recent.body.items.map((item: { id: string }) => item.id)).toContain(
      pushExercise,
    );
    expect(
      recent.body.items.map((item: { id: string }) => item.id),
    ).not.toContain(pullExercise);
    expect(
      (
        await h
          .get('/exercises/visible', other)
          .query({ selection: 'RECENT' })
          .expect(200)
      ).body.items,
    ).toEqual([]);
    const planningNow = await h.get(p.base + '/planning', owner).expect(200);
    expect(planningNow.body.weeks[0].days[0].exercises[0].targetLoad).toBe(
      80.125,
    );
    await h
      .send(
        'patch',
        `${base}/exercises/${executionId}`,
        { expectedVersion: complete.body.version, targetSets: 5 },
        owner,
      )
      .expect(409);
  });

  it('D: copies historical programming to an editable day and changes only that copy, retaining the session capture', async () => {
    const p = await planning();
    const prepared = await prepare(p, p.pushId).expect(201);
    const sessionBase = '/workout-sessions/' + prepared.body.id;
    const original = prepared.body.exercises[0].original;
    const current = await h.get(p.base + '/planning', owner).expect(200);
    const prescriptionId = current.body.weeks[0].days[0].exercises[0]
      .id as string;
    await h
      .send(
        'patch',
        `${p.weekBase}/days/${p.pushId}/exercises/${prescriptionId}`,
        { targetLoad: 90, targetLoadUnit: 'KG' },
        owner,
      )
      .expect(409);
    const copied = await h
      .send(
        'post',
        `${p.weekBase}/days/${p.pushId}/copy`,
        { position: 3, name: 'Push futuro' },
        owner,
      )
      .expect(201);
    const newDay = copied.body.weeks[0].days.find(
      (day: { position: number }) => day.position === 3,
    );
    expect(newDay.id).not.toBe(p.pushId);
    expect(newDay.exercises[0].id).not.toBe(prescriptionId);
    await h
      .send(
        'patch',
        `${p.weekBase}/days/${newDay.id}/exercises/${newDay.exercises[0].id}`,
        { targetLoad: 90, targetLoadUnit: 'KG' },
        owner,
      )
      .expect(200);
    expect(
      (await h.get(sessionBase, owner).expect(200)).body.exercises[0].original,
    ).toEqual(original);
    expect(
      (
        await h.prisma.planExercise.findUniqueOrThrow({
          where: { id: prescriptionId },
        })
      ).targetLoad!.toString(),
    ).toBe('80.125');
  });

  it('E: isolates private catalog, planning, calendar, sessions and series between real authenticated athletes', async () => {
    const p = await planning();
    const prepared = await prepare(p, p.pushId).expect(201);
    await h.get('/exercises/' + pushExercise, other).expect(404);
    await h.get(p.base, other).expect(404);
    await h.get(p.base + '/planning', other).expect(404);
    await prepare(p, p.pushId, other).expect(404);
    await h.get('/workout-sessions/' + prepared.body.id, other).expect(404);
    await h
      .send(
        'post',
        `/workout-sessions/${prepared.body.id}/exercises/${prepared.body.exercises[0].id}/sets`,
        {
          id: randomUUID(),
          expectedVersion: 0,
          setNumber: 1,
          status: 'COMPLETED',
          kind: 'WORK',
          repetitions: 8,
          load: '75',
          loadUnit: 'KG',
        },
        other,
      )
      .expect(404);
    const activity = await h
      .send(
        'post',
        '/routine/activities',
        {
          id: randomUUID(),
          scheduledOn: '2026-01-05',
          timeZone: 'America/Bogota',
          title: 'Descanso',
          status: 'REST',
        },
        owner,
      )
      .expect(201);
    await h
      .send(
        'patch',
        '/routine/activities/' + activity.body.id,
        { expectedVersion: 0, scheduledOn: '2026-01-06' },
        other,
      )
      .expect(404);
    const otherCalendar = await h
      .get('/routine/activities', other)
      .query({
        from: '2026-01-01',
        to: '2026-01-31',
        timeZone: 'America/Bogota',
      })
      .expect(200);
    expect(otherCalendar.body).toEqual([]);
  });

  it('F: refresh preserves bearer identity until explicit revocation, which immediately blocks protected module access', async () => {
    const actor = await h.actor();
    const account = await h.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    const peer = await h
      .http()
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: account.email, password: 'mvc6-fixture-password-123' })
      .expect(200);
    await h.get('/athletes/me', actor).expect(200);
    const refreshed = await h
      .http()
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('X-CSRF-Token', actor.csrf)
      .set('Cookie', `${actor.cookie}; pow_csrf=${actor.csrf}`)
      .expect(200);
    await h.get('/athletes/me', actor).expect(200);
    const cookies = refreshed.headers['set-cookie'] as unknown as string[];
    const refreshCookie = cookies
      .find((value) => value.startsWith('pow_refresh='))!
      .split(';')[0]!;
    await h
      .http()
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', refreshed.body.csrfToken)
      .set('Cookie', `${refreshCookie}; pow_csrf=${refreshed.body.csrfToken}`)
      .expect(204);
    await h.get('/athletes/me', actor).expect(401);
    await h
      .get('/training-plans', { ...actor, token: refreshed.body.accessToken })
      .expect(401);
    await h
      .get('/workout-sessions', { ...actor, token: peer.body.accessToken })
      .expect(200);
  });

  it('preserves an accepted suggestion calendar association through real Vue, HTTP and PostgreSQL', async () => {
    const p = await planning();
    const activity = await h
      .send(
        'post',
        '/routine/activities',
        {
          id: randomUUID(),
          planWeekId: p.weekId,
          planDayId: p.pushId,
          scheduledOn: '2026-01-05',
          timeZone: 'America/Bogota',
          title: 'Push calendarizado MVC6',
          status: 'PLANNED',
        },
        owner,
      )
      .expect(201);
    const suggestions = await h
      .get('/workout-sessions/suggestions', owner)
      .query({ performedOn: '2026-01-05', timeZone: 'America/Bogota' })
      .expect(200);
    const candidate = suggestions.body.candidates.find(
      (item: { scheduledActivityId?: string }) =>
        item.scheduledActivityId === activity.body.id,
    );
    expect(candidate).toBeDefined();
    const output = await vueHttp(
      h.app,
      `
      import assert from 'node:assert/strict';
      import {resolve} from 'node:path';
      import {createRenderer} from 'vue';
      import {createServer} from 'vite';
      import {api} from './src/services/api.ts';
      import {workoutSessionsService} from './src/services/workout-sessions.service.ts';
      let raw='';for await(const part of process.stdin)raw+=part;
      const {baseURL,token,candidate}=JSON.parse(raw);api.defaults.baseURL=baseURL;api.defaults.headers.common.Authorization='Bearer '+token;
      const server=await createServer({configFile:resolve('vite.config.ts'),appType:'custom',
        server:{middlewareMode:true,hmr:false,ws:false},logLevel:'error',plugins:[{name:'mvc6-memory-router',enforce:'pre',
        transform(code,id){if(id.endsWith('/src/router/index.ts'))return code.replaceAll('createWebHistory','createMemoryHistory')}}]});
      let app;
      try{
        const component=(await server.ssrLoadModule('/src/components/workouts/StartWorkoutForm.vue')).default;
        const renderer=createRenderer({createElement:()=>({}),createText:()=>({}),createComment:()=>({}),insert(){},remove(){},
          setText(){},setElementText(){},patchProp(){},parentNode:()=>null,nextSibling:()=>null});
        let result,payload;
        app=renderer.createApp({...component,render:()=>null},{save:async input=>{payload=input;result=await workoutSessionsService.create(input)}});
        app.provide(Symbol.for('v-scx'),{modules:new Set()});
        const state=app.mount({}).$.setupState;state.performedOn='2026-01-05';state.timeZone='America/Bogota';state.recordingMode='RETROSPECTIVE';
        state.accept(candidate);await state.submit();
        assert.ok(result);assert.equal(payload.scheduledActivityId,candidate.scheduledActivityId);assert.equal(result.scheduledActivityId,candidate.scheduledActivityId);
        assert.equal(result.planDay.id,candidate.planDayId);
        console.log('SUGGESTION_RESULT '+JSON.stringify({id:result.id}));
      }finally{app?.unmount();await server.close()}
    `,
      { token: owner.token, candidate },
    );
    const id = JSON.parse(output.split('SUGGESTION_RESULT ')[1]!.trim())
      .id as string;
    expect(
      (await h.prisma.workoutSession.findUniqueOrThrow({ where: { id } }))
        .scheduledActivityId,
    ).toBe(activity.body.id);
    const calendar = await h
      .get('/routine/activities', owner)
      .query({
        from: '2026-01-05',
        to: '2026-01-05',
        timeZone: 'America/Bogota',
      })
      .expect(200);
    expect(
      calendar.body.find((item: { id: string }) => item.id === activity.body.id)
        .workouts,
    ).toEqual([expect.objectContaining({ id })]);
    const detail = await h.get('/workout-sessions/' + id, owner).expect(200);
    expect(detail.body.sourceSnapshot.schedule.id).toBe(activity.body.id);
    const free = await h.send('post', '/workout-sessions', { id: randomUUID(), performedOn: '2026-01-05',
      timeZone: 'America/Bogota', recordingMode: 'RETROSPECTIVE' }, owner).expect(201);
    expect(free.body.scheduledActivityId).toBeNull();
    const foreign = await h.send('post', '/routine/activities', { id: randomUUID(), scheduledOn: '2026-01-05',
      timeZone: 'America/Bogota', title: 'Ajena', status: 'REST' }, other).expect(201);
    await prepare(p, p.pushId, owner, { scheduledActivityId: foreign.body.id }).expect(404);
    await prepare(p, p.pullId, owner, { scheduledActivityId: activity.body.id }).expect(404);
  });

  it.each(['revoked', 'expired'] as const)('rejects global logout without confirming success when the refresh is %s', async (kind) => {
    const actor = await h.actor();
    const session = await h.prisma.authSession.findFirstOrThrow({ where: { userId: actor.id } });
    await h.prisma.authSession.update({ where: { id: session.id }, data: kind === 'revoked'
      ? { revokedAt: new Date() }
      : { createdAt: new Date(Date.now() - 10 * 86400000), expiresAt: new Date(Date.now() - 1000) } });
    const config = h.app.get(AuthConfig);
    const expired = sign({ sub: actor.id, sid: session.id, exp: 1 }, config.accessTokenSecret,
      { algorithm: 'HS256', issuer: config.issuer, audience: config.audience });
    const output = await vueHttp(h.app, `
      import assert from 'node:assert/strict';
      import {createPinia,setActivePinia} from 'pinia';
      import {api,installAuthInterceptors} from './src/services/api.ts';
      import {useAuthStore} from './src/stores/auth.store.ts';
      let raw='';for await(const part of process.stdin)raw+=part;
      const {baseURL,expired,csrf,cookie}=JSON.parse(raw);api.defaults.baseURL=baseURL;
      api.defaults.headers.common.Origin='http://localhost:5173';api.defaults.headers.common.Cookie=cookie+'; pow_csrf='+csrf;
      const calls=[];api.interceptors.request.use(config=>{calls.push(config.url);return config});
      setActivePinia(createPinia());const store=useAuthStore();store.accessToken=expired;store.csrfToken=csrf;store.status='authenticated';
      installAuthInterceptors({getAccessToken:()=>store.accessToken,refreshSession:store.refreshSession,clearSession:store.clearSession});
      await assert.rejects(store.logoutAll(),error=>error.response?.status===401);
      assert.equal(store.status,'anonymous');assert.equal(store.accessToken,null);
      assert.deepEqual(calls,['/auth/logout-all','/auth/refresh']);
      console.log('Rejected global logout verified');
    `, { expired, csrf: actor.csrf, cookie: actor.cookie });
    expect(output).toContain('Rejected global logout verified');
    expect((await h.prisma.authSession.findUniqueOrThrow({ where: { id: session.id } })).generation).toBe(0);
    await h.get('/athletes/me', other).expect(200);
  });

  it('renews expired access for global logout with fresh CSRF and persists revocation for all owner devices', async () => {
    const actor = await h.actor();
    const session = await h.prisma.authSession.findFirstOrThrow({
      where: { userId: actor.id },
    });
    const account = await h.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    await h.http().post('/api/v1/auth/login').set('Origin', origin)
      .send({ email: account.email, password: 'mvc6-fixture-password-123' }).expect(200);
    const config = h.app.get(AuthConfig);
    const expired = sign(
      { sub: actor.id, sid: session.id, exp: 1 },
      config.accessTokenSecret,
      { algorithm: 'HS256', issuer: config.issuer, audience: config.audience },
    );
    const output = await vueHttp(
      h.app,
      `
      import assert from 'node:assert/strict';
      import {createPinia,setActivePinia} from 'pinia';
      import {api,installAuthInterceptors} from './src/services/api.ts';
      import {useAuthStore} from './src/stores/auth.store.ts';
      let raw='';for await(const part of process.stdin)raw+=part;
      const {baseURL,expired,csrf,cookie}=JSON.parse(raw);api.defaults.baseURL=baseURL;
      api.defaults.headers.common.Origin='http://localhost:5173';
      const jar=new Map([cookie.split('='),['pow_csrf',csrf]]);
      const requests=[];
      api.interceptors.request.use(config=>{requests.push(config.url);config.headers.set('Cookie',[...jar].map(([k,v])=>k+'='+v).join('; '));return config});
      api.interceptors.response.use(response=>{for(const value of response.headers['set-cookie']??[]){const pair=value.split(';')[0],index=pair.indexOf('=');const key=pair.slice(0,index),v=pair.slice(index+1);if(v)jar.set(key,v);else jar.delete(key)}return response});
      setActivePinia(createPinia());const store=useAuthStore();store.accessToken=expired;store.csrfToken=csrf;store.status='authenticated';
      installAuthInterceptors({getAccessToken:()=>store.accessToken,refreshSession:store.refreshSession,clearSession:store.clearSession});
      await store.logoutAll();
      assert.deepEqual(requests,['/auth/logout-all','/auth/refresh','/auth/me','/auth/logout-all']);
      assert.equal(jar.size,0);
      assert.equal(store.status,'anonymous');assert.equal(store.accessToken,null);
      console.log('Global logout renewal verified');
    `,
      { expired, csrf: actor.csrf, cookie: actor.cookie },
    );
    expect(output).toContain('Global logout renewal verified');
    expect(
      (
        await h.prisma.authSession.findUniqueOrThrow({
          where: { id: session.id },
        })
      ).revokedAt,
    ).not.toBeNull();
    await h.get('/athletes/me', actor).expect(401);
    expect(await h.prisma.authSession.count({ where: { userId: actor.id, revokedAt: null } })).toBe(0);
    await h.get('/athletes/me', other).expect(200);
  });
});
