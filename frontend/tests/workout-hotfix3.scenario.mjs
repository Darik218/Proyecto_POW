import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function runHotfix3({
  api,
  athleteId,
  check,
  click,
  command,
  field,
  execute,
  go,
  health,
  immutableHistory,
  immutablePlans,
  navigate,
  observeRequests,
  origin,
  prepareCatalog,
  recordWholeSession,
  saveEvidence,
  shift,
  sql,
  sync,
  textClick,
  today,
  until,
  viewport,
  zone,
}) {
  const release = process.env.RENDER_GIT_COMMIT;
  if (release) {
    await check(
      "HF3.0 HTML y API verifican la misma identidad de release",
      async () => {
        const [html, backend] = await Promise.all([
          fetch(origin),
          fetch(origin + "/api/v1"),
        ]);
        assert.equal(html.headers.get("x-pulso-release"), release);
        assert.equal(backend.headers.get("x-pulso-release"), release);
        assert.match(html.headers.get("cache-control"), /no-store/);
        assert.match(
          await html.text(),
          new RegExp('name="pulso-release" content="' + release + '"'),
        );
        return { release };
      },
    );
  }
  await prepareCatalog();
  const names = [
    "Press de hombros en máquina Smith",
    "Press de banca plano con barra olímpica",
  ];
  const { rows: catalog } = await sql.query(
    "SELECT id, name, catalog_key FROM exercises WHERE name=ANY($1) AND origin='GLOBAL' AND is_active ORDER BY array_position($1::text[],name)",
    [names],
  );
  assert.deepEqual(
    catalog.map((exercise) => exercise.name),
    names,
  );
  assert.ok(catalog.every((exercise) => exercise.catalog_key));
  const history = [
    [10, 9, 8],
    [12, 11, 9],
  ];
  const expected = [
    [10, 9, 9],
    [12, 11, 10],
  ];
  const previousDate = shift(-7);
  const weekday = new Date(today + "T00:00:00Z").getUTCDay() || 7;
  const targets = { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12 };
  const plan = await api(
    "post",
    "/routine/plans",
    {
      id: randomUUID(),
      name: "PPL HOTFIX-3",
      durationWeeks: 2,
      frequency: 3,
      startsOn: previousDate,
      timeZone: zone,
      days: ["Push", "Pull", "Legs"].map((name, index) => ({
        name,
        weekday: ((weekday + index * 2 - 1) % 7) + 1,
        exercises:
          index === 0
            ? catalog.map(({ id }, position) => ({
                ...targets,
                exerciseId: id,
                position: position + 1,
              }))
            : [],
      })),
    },
    201,
  );
  const draft = await api("get", `/training-plans/${plan.id}/planning`);
  await api(
    "post",
    `/routine/plans/${plan.id}/activate`,
    { id: randomUUID(), expectedVersion: draft.version },
    201,
  );
  const planning = await api("get", `/training-plans/${plan.id}/planning`);
  const days = planning.weeks.map((week) => ({
    week,
    day: week.days.find((day) => day.name === "Push"),
  }));
  assert.notEqual(days[0].day.exercises[0].id, days[1].day.exercises[0].id);
  for (const [index, target] of days.entries()) {
    const {
      rows: [activity],
    } = await sql.query(
      "SELECT id, version, scheduled_on::text AS date FROM scheduled_activities WHERE plan_day_id=$1",
      [target.day.id],
    );
    assert.ok(activity);
    target.activity = activity;
    const date = index === 0 ? previousDate : today;
    if (activity.date !== date)
      await api("patch", `/routine/activities/${activity.id}`, {
        expectedVersion: activity.version,
        scheduledOn: date,
      });
    target.route =
      `/app/routine/${plan.id}/weeks/${target.week.id}/days/${target.day.id}?` +
      new URLSearchParams({ date, activityId: activity.id, timeZone: zone });
  }
  const [prior, next] = days;
  const waitGuide = () =>
    until(
      () =>
        sync(
          'return document.querySelector(".daily-guide")?.getAttribute("aria-busy")==="false" && !!document.querySelector(".guide-exercise")',
        ),
      "guía visible",
    );
  const startVisible = async () => {
    const pattern =
      /Empezar entrenamiento|Registrar entrenamiento de esta fecha/;
    const label = await sync(
      'return [...document.querySelectorAll(".routine-start-panel button")].find(e=>!e.disabled&&/Empezar entrenamiento|Registrar entrenamiento de esta fecha/.test(e.textContent))?.textContent.trim()',
    );
    assert.match(label, pattern);
    await textClick(".routine-start-panel button", label);
    await until(
      () =>
        sync(
          'return !!document.querySelector(".workout-live .quick-set-form")',
        ),
      "sesión en vivo",
    );
    return sync('return location.pathname.split("/").pop()');
  };
  const pathForGuide = (query) =>
    "/progression/workout-guide?" + new URLSearchParams(query);
  const selectDecision = (guide) =>
    guide.exercises.map((row) => ({
      id: row.exerciseId,
      reference: row.lastReference?.sessions.map(
        (session) => session.sessionId,
      ),
      state: row.progressiveContext?.comparability?.state,
      reasons: row.progressiveContext?.reasons,
      draft: row.preparation?.draft,
      stage: row.preparation?.stage,
    }));
  const verifyCards = async () => {
    const cards =
      await sync(`return [...document.querySelectorAll(".daily-guide .guide-exercise")].map(
      (card) => ({ text: card.textContent, draft: card.querySelector(".preparation-draft")?.textContent ?? "", stage: card.querySelector(".workout-preparation")?.dataset.stage, confirmation: !!card.querySelector(".repetition-preview-button") })
    )`);
    assert.equal(cards.length, 2);
    for (const [i, card] of cards.entries()) {
      assert.ok(card.text.includes(names[i]));
      assert.equal(card.stage, "REPETITION_DRAFT");
      assert.match(
        card.draft.replace(/\s+/g, " "),
        new RegExp("60 kg.*" + expected[i].join(" / ")),
      );
      assert.equal(card.confirmation, false);
      assert.doesNotMatch(
        card.text,
        /HISTORY_REPETITIONS_INCONSISTENT|CONFIRMATION_REQUIRED|KNOWN_LOAD_BASELINE_REQUIRED/,
      );
    }
  };
  let historicalId, historicalSets, plans, records;
  await check(
    "HF3.1 PPL activo y Push real con Smith y banca registrados sin esfuerzo",
    async () => {
      await viewport(390, 844);
      await go(prior.route);
      await waitGuide();
      const first = await api(
        "get",
        pathForGuide({ activityId: prior.activity.id }),
      );
      assert.ok(
        first.exercises.every((row) => row.preparation.stage === "PLAN_ONLY"),
      );
      historicalId = await startVisible();
      const completed = await recordWholeSession(historicalId, {
        load: 60,
        reps: (i, n) => history[i][n - 1],
      });
      assert.equal(completed.status, "COMPLETED");
      assert.equal(completed.scheduledActivityId, prior.activity.id);
      historicalSets = completed.exercises.map((exercise) => exercise.sets);
      plans = await immutablePlans();
    },
  );
  await check(
    "HF3.2 un entrenamiento libre posterior no desplaza el historial acreditado del plan",
    async () => {
      let free = await api(
        "post",
        "/workout-sessions",
        {
          id: randomUUID(),
          name: "Referencia libre separada",
          performedOn: shift(-3),
          timeZone: zone,
          recordingMode: "RETROSPECTIVE",
        },
        201,
      );
      for (const { id: exerciseId } of catalog) {
        free = await api(
          "post",
          `/workout-sessions/${free.id}/exercises`,
          {
            ...targets,
            id: randomUUID(),
            expectedVersion: free.version,
            exerciseId,
          },
          201,
        );
      }
      if (free.status === "PLANNED")
        free = await api(
          "post",
          `/workout-sessions/${free.id}/start`,
          { expectedVersion: free.version },
          200,
        );
      await go(`/app/workouts/${free.id}`);
      await recordWholeSession(free.id, { load: 70, reps: 8 });
      records = await immutableHistory();

      const byActivity = pathForGuide({ activityId: next.activity.id });
      const byDay = pathForGuide({
        planDayId: next.day.id,
        performedOn: today,
        timeZone: zone,
      });
      const responses = await execute(
        `
        return await Promise.all(arguments[0].map(async (path) => {
          const response = await fetch("/api/v1" + path, {
            headers: { Authorization: "Bearer " + auth.accessToken },
          });
          return { status: response.status, body: await response.json() };
        }));
      `,
        [[byActivity, byDay, byActivity]],
      );
      assert.ok(
        responses.every((response) => response.status === 200),
        JSON.stringify(responses),
      );
      const results = responses.map((response) => response.body);
      const decisions = results.map(selectDecision);
      await saveEvidence("guide-decisions.json", {
        fixture: names,
        activity: decisions[0],
        day: decisions[1],
        repeated: decisions[2],
      });
      assert.deepEqual(decisions[0], decisions[1]);
      assert.deepEqual(decisions[0], decisions[2]);
      for (const [index, row] of results[0].exercises.entries()) {
        assert.equal(
          row.progressiveContext.comparability.state,
          "AUTOMATIC_VERIFIED",
          JSON.stringify(decisions[0]),
        );
        assert.deepEqual(row.preparation.draft.repsBySet, expected[index]);
        assert.equal(row.lastReference.sessions[0].sessionId, historicalId);
        assert.equal(row.preparation.executionAuthorized, false);
      }
      await go(next.route);
      await waitGuide();
      await verifyCards();
      await observeRequests();
      for (let reload = 0; reload < 5; reload++) {
        await command("/refresh", "POST", {});
        await waitGuide();
        await verifyCards();
      }
      for (const [width, height] of [
        [320, 800],
        [390, 844],
        [1440, 1000],
      ]) {
        await viewport(width, height);
        await sync(
          'document.querySelector(".guide-exercise").scrollIntoView({block:"start"})',
        );
        await health(`smith-banca-${width}`);
      }
      assert.equal(await immutablePlans(), plans);
      assert.equal(await immutableHistory(), records);
    },
  );
  await check(
    "HF3.3 Inicio, Mi plan, Progreso y sesión activa preservan orientación y edición",
    async () => {
      await viewport(390, 844);
      await navigate("Inicio");
      await until(
        () =>
          sync(
            'return document.querySelector(".weekly-training")?.getAttribute("aria-busy")==="false"',
          ),
        "calendario",
      );
      await click(`.week-days button[aria-label*="${today}"]`);
      await waitGuide();
      await verifyCards();

      await navigate("Progreso");
      await until(
        () =>
          sync(
            'return !!document.querySelector("[data-testid=progress-plan]")',
          ),
        "controles de progreso",
      );
      await field("[data-testid=progress-plan]", plan.id);
      await field("[data-testid=progress-plan-day]", next.day.id);
      const progression = `[data-testid=progress-next-guide] a[href*="${next.activity.id}"]`;
      await until(
        () =>
          sync("return !!document.querySelector(arguments[0])", [progression]),
        "preparar desde Progreso",
      );
      await click(progression);
      await waitGuide();
      await verifyCards();

      const activeId = await startVisible();
      const guidance = await api("get", pathForGuide({ sessionId: activeId }));
      assert.deepEqual(
        guidance.exercises.map((row) => row.preparation.draft?.repsBySet),
        expected,
      );
      const completed = await recordWholeSession(activeId, {
        load: 61,
        reps: 10,
        afterFirstSet: async () => {
          const queries = [
            { sessionId: activeId },
            { activityId: next.activity.id },
            { planDayId: next.day.id, performedOn: today, timeZone: zone },
          ];
          for (const query of queries) {
            const current = await api("get", pathForGuide(query));
            assert.deepEqual(
              current.exercises.map((row) => row.preparation.draft?.repsBySet),
              expected,
            );
            assert.ok(
              current.exercises.every(
                (row) =>
                  row.lastReference.sessions[0].sessionId === historicalId,
              ),
            );
          }
        },
        beforeFirstSet: async () => {
          const input = '.quick-set-form input[id$="-load"]';
          await until(
            () =>
              sync(
                "return document.querySelector(arguments[0])?.value==='60'",
                [input],
              ),
            "carga propuesta",
          );
          await field(input, 61);
          const original = await command("/window");
          const { handle: other } = await command("/window/new", "POST", {
            type: "tab",
          });
          await command("/window", "POST", { handle: other });
          await command("/window", "DELETE");
          await command("/window", "POST", { handle: original });
          await until(
            () =>
              sync(
                "const el=document.querySelector(arguments[0]);return !!el?.getClientRects().length",
                [input],
              ),
            "pestaña validada",
          );
          assert.equal(
            await sync("return document.querySelector(arguments[0])?.value", [
              input,
            ]),
            "61",
          );
        },
      });
      assert.equal(completed.status, "COMPLETED");
      assert.equal(await immutablePlans(), plans);
      const original = await api("get", `/workout-sessions/${historicalId}`);
      assert.deepEqual(
        original.exercises.map((exercise) => exercise.sets),
        historicalSets,
      );
      const {
        rows: [persisted],
      } = await sql.query(
        "SELECT MIN(r.load)::text AS load, COUNT(*)::int AS sets FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id WHERE e.session_id=$1",
        [activeId],
      );
      assert.equal(Number(persisted.load), 61);
      assert.equal(persisted.sets, 6);
      const {
        rows: [automatic],
      } = await sql.query(
        "SELECT COUNT(*)::int AS count FROM progression_applications WHERE athlete_id=$1",
        [athleteId],
      );
      assert.equal(automatic.count, 0);
    },
  );
}
