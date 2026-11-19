import assert from "node:assert/strict";

const widths = [
  [320, 800],
  [390, 844],
  [768, 1024],
  [1440, 1000],
];
const normalized = (text) => text.replace(/\s+/g, " ").trim();

export async function runUiFinal({
  api,
  athleteId,
  check,
  click,
  command,
  field,
  go,
  health,
  hotfix = false,
  immutableHistory,
  immutablePlans,
  navigate,
  observeRequests,
  prepareCatalog,
  recordWholeSession,
  shift,
  shot,
  sql,
  sync,
  textClick,
  today,
  until,
  viewport,
  zone,
}) {
  const name = "PPL seis días · UI FINAL";
  const visualFaults = [];
  const priorLoad = hotfix ? 60 : 40;
  const priorReps = hotfix ? [12, 11, 9] : [8, 8, 8];
  const nextReps = hotfix ? [12, 11, 10] : [9, 9, 9];
  const firstOffset = -(
    (new Date(today + "T00:00:00Z").getUTCDay() + 4) % 7 || 7
  );
  const startsOn = shift(firstOffset - 2);
  const firstDate = shift(firstOffset);
  const secondDate = shift(firstOffset + 7);
  let planId, planning, firstDay, secondDay, firstActivity, secondActivity;
  let firstSession, secondSession, startingPlans, startingHistory, firstRows;
  const activityFor = async (dayId) => {
    const result = await sql.query(
      "SELECT id, scheduled_on::text AS date, time_zone AS zone FROM scheduled_activities WHERE plan_day_id=$1 ORDER BY scheduled_on LIMIT 1",
      [dayId],
    );
    assert.ok(result.rows[0], "La sesión tiene una actividad real programada");
    return result.rows[0];
  };
  const sessionRows = async (id) =>
    (
      await sql.query(
        "SELECT r.id,r.load::text,r.load_unit,r.repetitions,r.rpe,r.rir FROM set_records r JOIN workout_exercises e ON e.id=r.workout_exercise_id WHERE e.session_id=$1 ORDER BY e.order_in_session,r.set_number",
        [id],
      )
    ).rows;
  const waitVisible = (selector, label = selector) =>
    until(
      () =>
        sync(
          "const el=document.querySelector(arguments[0]);return !!el?.getClientRects().length",
          [selector],
        ),
      label,
    );
  const waitProgress = () =>
    until(
      () =>
        sync(
          'return document.querySelector("[data-testid=progress-overview]")?.getAttribute("aria-busy")==="false"&&!!document.querySelector("[data-testid=progress-exercise]")',
        ),
      "resultados reales de Progreso",
    );
  async function sweep(name, ready, anchor) {
    const sizes = [];
    for (const [width, height] of widths) {
      const capture = name + "-" + width;
      try {
        await viewport(width, height);
        if (ready) await ready();
        if (anchor)
          await sync(
            "document.querySelector(arguments[0]).scrollIntoView({block:'start'})",
            [anchor],
          );
        else await sync("scrollTo(0,0)");
        const state = await health(capture);
        assert.equal(state.width, width);
        sizes.push(width);
      } catch (error) {
        visualFaults.push({ capture, error: error.message });
        console.error("Responsive check " + capture + ": " + error.message);
        await shot(capture + "-failure");
      }
    }
    await viewport(390, 844);
    return sizes;
  }
  async function calendar(date) {
    await navigate("Inicio");
    await until(
      () =>
        sync(
          'return location.pathname==="/app/overview"&&document.querySelector(".weekly-training")?.getAttribute("aria-busy")==="false"',
        ),
      "calendario de Inicio",
    );
    const selector = `.week-days button[aria-label*="${date}"]`;
    for (let i = 0; i < 3; i++) {
      if (
        await sync("return !!document.querySelector(arguments[0])", [selector])
      )
        break;
      const firstLabel = await sync(
        'return document.querySelector(".week-days button").getAttribute("aria-label")',
      );
      const first = firstLabel.match(/\d{4}-\d{2}-\d{2}/)[0];
      await click(
        date < first
          ? '[aria-label="Semana anterior"]'
          : '[aria-label="Semana siguiente"]',
      );
      await until(
        () =>
          sync(
            'return document.querySelector(".weekly-training")?.getAttribute("aria-busy")==="false"&&document.querySelector(".week-days button")?.getAttribute("aria-label")!==arguments[0]',
            [firstLabel],
          ),
        "nueva semana",
      );
    }
    await click(selector);
    const choices = await sync(
      'return [...document.querySelectorAll(".activity-choices button")].map(e=>e.textContent.replace(/\\s+/g," ").trim())',
    );
    if (choices.length) {
      const legsA = choices.find((choice) => choice.startsWith("Legs A"));
      assert.ok(legsA, JSON.stringify(choices));
      await textClick(".activity-choices button", legsA);
    }
    await until(
      () =>
        sync(
          'return [...document.querySelectorAll(".weekly-training h3")].some(e=>e.textContent.includes("Legs A"))&&document.querySelector(".weekly-training .daily-guide")?.getAttribute("aria-busy")==="false"',
        ),
      "Legs A aparece en el calendario",
    );
  }
  async function startCalendar(activity, label) {
    await observeRequests();
    await textClick(".weekly-training button", label);
    await waitVisible(
      ".workout-live .quick-set-form",
      "registro rápido disponible",
    );
    const id = await sync('return location.pathname.split("/").pop()');
    const response = await api("get", "/workout-sessions/" + id);
    assert.equal(response.scheduledActivityId, activity.id);
    assert.equal(response.performedOn.slice(0, 10), activity.date);
    assert.equal(response.timeZone, activity.zone);
    assert.equal(
      response.recordingMode,
      activity.date === today ? "LIVE" : "RETROSPECTIVE",
    );
    assert.equal(response.actualSetCount, 0);
    const creates = await sync(
      'return window.__prog7Requests.filter(r=>r.method==="POST"&&r.path.endsWith("/workout-sessions"))',
    );
    assert.equal(creates.length, 1);
    assert.equal(creates[0].body.scheduledActivityId, activity.id);
    return id;
  }
  function waitForDrawer() {
    return until(
      () =>
        sync(`
        const drawer = document.querySelector(".app-sidebar[aria-modal=true]");
        const bounds = drawer?.getBoundingClientRect();
        return !!bounds && bounds.left >= -1 && bounds.right > 240;
      `),
      "menú modal dentro de la pantalla",
    );
  }
  async function keyboard(...keys) {
    const actions = [];
    for (const value of keys) actions.push({ type: "keyDown", value });
    for (const value of keys.toReversed())
      actions.push({ type: "keyUp", value });
    await command("/actions", "POST", {
      actions: [{ type: "key", id: "keys", actions }],
    });
  }

  await check(
    "UI01 cuenta auténtica, navegación inicial y catálogo global",
    async () => {
      const catalog = await prepareCatalog();
      assert.ok(athleteId);
      assert.ok(catalog.exercises >= 200);
      assert.match(
        await sync("return location.pathname"),
        /^\/app(?:\/overview)?$/,
      );
      assert.equal(
        await sync(
          'return matchMedia("(prefers-reduced-motion: reduce)").matches',
        ),
        true,
      );
      return { today, zone, catalog };
    },
  );

  await check(
    "UI02 asistente guiado guarda PPL × 6 / Push × 7 / 3–2–2 y activa por separado",
    async () => {
      if (!(await sync('return location.pathname==="/app"')))
        await navigate("Mi plan");
      await until(
        () =>
          sync(
            'return !!document.querySelector("#routine-frequency,[data-create-mode=recommended]")',
          ),
        "entrada directa del registro o selector de modo",
      );
      if (
        !(await sync('return !!document.querySelector("#routine-frequency")'))
      )
        await click('[data-create-mode="recommended"]');
      await field("#routine-frequency", "6");
      await waitVisible(".template-option:has(#routine-template-ppl)");
      await click(".template-option:has(#routine-template-ppl)");
      await click('.routine-wizard input[value="fixed"]');
      for (const day of [1, 2, 3, 4, 5, 6]) {
        const selector = "#routine-weekday-" + day;
        if (
          !(await sync("return document.querySelector(arguments[0])?.checked", [
            selector,
          ]))
        )
          await click(selector);
      }
      await sweep("wizard-distribution");
      await click(".wizard-actions .primary-button");
      await field("#routine-goal", "HYPERTROPHY");
      await field("#routine-experience", "INTERMEDIATE");
      for (const equipment of [
        "BARBELL",
        "DUMBBELL",
        "CABLE",
        "MACHINE",
        "BODYWEIGHT",
      ]) {
        const selector = "#routine-equipment-" + equipment;
        if (
          !(await sync("return document.querySelector(arguments[0])?.checked", [
            selector,
          ]))
        )
          await click(selector);
      }
      await click(".wizard-advanced > summary");
      await field("#routine-exercise-count", "7");
      await field("#routine-allocation-push-pectorales", "3");
      await field("#routine-allocation-push-deltoides", "2");
      await field("#routine-allocation-push-triceps", "2");
      await field("#routine-variant-push", "same");
      await field("#routine-variant-legs", "same");
      await textClick(".wizard-actions button", "Ver propuesta");
      await until(
        () => sync('return document.querySelectorAll(".block-tab").length===6'),
        "propuesta PPL",
      );
      await field("#routine-name", name);
      await field("#routine-weeks", "2");
      await field("#routine-start", startsOn);
      await sweep("wizard-proposal");
      const firstTarget =
        ".exercise-targets:first-of-type .target-grid label:first-child input";
      await field(firstTarget, 4);
      await textClick(".wizard-actions button", "Atrás");
      await textClick(".wizard-actions button", "Ver propuesta");
      await waitVisible(firstTarget);
      assert.equal(
        await sync("return document.querySelector(arguments[0]).value", [
          firstTarget,
        ]),
        "4",
      );
      await field(firstTarget, 3);
      await observeRequests();
      await click(".wizard-actions .primary-button");
      await until(
        () =>
          sync(
            'return document.querySelector(".routine-current h2")?.textContent.trim()===arguments[0]',
            [name],
          ),
        "borrador guardado",
      );
      planId = await sync(
        'return new URL(location.href).searchParams.get("planId")',
      );
      assert.ok(planId);
      planning = await api("get", `/training-plans/${planId}/planning`);
      assert.equal(planning.status, "DRAFT");
      assert.deepEqual(
        planning.weeks.map((week) => week.days.length),
        [6, 6],
      );
      assert.deepEqual(
        planning.weeks[0].days.map((day) => day.name),
        ["Push A", "Pull A", "Legs A", "Push B", "Pull B", "Legs B"],
      );
      const [pushA, pushB] = [
        planning.weeks[0].days[0],
        planning.weeks[0].days[3],
      ];
      assert.equal(pushA.exercises.length, 7);
      assert.deepEqual(
        pushA.exercises.map((e) => e.exercise.id),
        pushB.exercises.map((e) => e.exercise.id),
      );
      const { rows } = await sql.query(
        "SELECT m.key,count(*)::int AS count FROM plan_exercises p JOIN exercises e ON e.id=p.exercise_id JOIN muscle_groups m ON m.id=e.primary_muscle_group_id WHERE p.plan_day_id=$1 GROUP BY m.key",
        [pushA.id],
      );
      const allocation = Object.fromEntries(
        rows.map(({ key, count }) => [key, count]),
      );
      assert.deepEqual(allocation, { pectorales: 3, deltoides: 2, triceps: 2 });
      await textClick(
        ".routine-current .plan-actions button",
        "Usar como plan activo",
      );
      await until(
        () =>
          sync(
            'return document.querySelector(".routine-status")?.dataset.status==="ACTIVE"',
          ),
        "activación explícita",
      );
      const writes = await sync(
        'return window.__prog7Requests.filter(r=>r.method==="POST"&&(r.path.endsWith("/routine/plans")||r.path.endsWith("/activate")))',
      );
      assert.deepEqual(
        writes.map((row) => row.path.split("/").at(-1)),
        ["plans", "activate"],
      );
      planning = await api("get", `/training-plans/${planId}/planning`);
      firstDay = planning.weeks[0].days.find((day) => day.name === "Legs A");
      secondDay = planning.weeks[1].days.find((day) => day.name === "Legs A");
      assert.notEqual(firstDay.exercises[0].id, secondDay.exercises[0].id);
      assert.equal(
        firstDay.exercises[0].exercise.id,
        secondDay.exercises[0].exercise.id,
      );
      firstActivity = await activityFor(firstDay.id);
      secondActivity = await activityFor(secondDay.id);
      assert.equal(firstActivity.date, firstDate);
      assert.equal(secondActivity.date, secondDate);
      startingPlans = await immutablePlans();
      return {
        planId,
        allocation,
        firstActivity,
        secondActivity,
        widths: await sweep("mi-plan-activo"),
      };
    },
  );

  await check(
    "UI03 Inicio abre Legs A real, registra y corrige una serie sin RPE/RIR, y finaliza",
    async () => {
      await calendar(firstDate);
      if (hotfix) {
        const initial = ".daily-guide .guide-exercise .workout-preparation";
        await waitVisible(initial);
        const card = await sync(
          "const e = document.querySelector(arguments[0]);return {stage:e.dataset.stage, text:e.textContent, details:e.querySelectorAll('details').length}",
          [initial],
        );
        assert.equal(card.stage, "PLAN_ONLY");
        assert.equal(card.details, 0);
        assert.match(card.text, /objetivo/i);
        assert.doesNotMatch(
          card.text,
          /NO_ELIGIBLE_HISTORY|KNOWN_LOAD_BASELINE_REQUIRED|INCREMENT_REQUIRED|SETTING_REQUIRED/,
        );
        assert.deepEqual(
          await sync(
            "const style=getComputedStyle(document.documentElement);return ['--color-background','--color-primary','--color-secondary'].map(x=>style.getPropertyValue(x).trim())",
          ),
          ["#0b1020", "#31e6c5", "#b8ff65"],
        );
      }
      await sweep("inicio-calendario-legs-a");
      firstSession = await startCalendar(
        firstActivity,
        "Registrar entrenamiento anterior",
      );
      const complete = await recordWholeSession(firstSession, {
        offset: priorLoad - 40,
        reps: (index, n) => (index === 0 ? priorReps[n - 1] : 8),
        beforeFirstSet: async () => {
          await sweep("entrenamiento-en-curso");
          await viewport(320, 800);
          await sync(
            "document.querySelector('.quick-set-form').scrollIntoView({block:'start'})",
          );
          const controls = await sync(`
            const form = document.querySelector(".quick-set-form");
            return ['input[id$="-load"]','select[id$="-unit"]','input[id$="-reps"]','button[type="submit"]'].map((selector) => {
              const element = form.querySelector(selector);
              const rect = element.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.left + rect.width/2, rect.top + rect.height/2);
              return hit === element || element.contains(hit);
            });
          `);
          assert.deepEqual(controls, [true, true, true, true]);
          await health("entrenamiento-320-formulario-completo");
          await viewport(390, 844);
        },
        afterFirstSet: async (task) => {
          const before = (await sessionRows(firstSession))[0];
          assert.equal(Number(before.load), priorLoad);
          assert.equal(before.repetitions, priorReps[0]);
          const editButton =
            '.live-review button[aria-label^="Editar serie 1"]';
          const summary = ".live-review:not(.live-overview) > summary";
          await click(summary);
          await waitVisible(editButton);
          await click(editButton);
          const edit = ".live-review form";
          await field(edit + ' input[id$="-reps"]', 9);
          await textClick(edit + " button", "Guardar cambios");
          await until(
            async () => (await sessionRows(firstSession))[0].repetitions === 9,
            "serie modificada",
          );
          await waitVisible(editButton);
          await click(editButton);
          await field(edit + ' input[id$="-reps"]', priorReps[0]);
          await textClick(edit + " button", "Guardar cambios");
          await until(
            async () =>
              (await sessionRows(firstSession))[0].repetitions === priorReps[0],
            "referencia reproducible",
          );
          assert.equal(
            (await sessionRows(firstSession))[0].id,
            before.id,
            task.exercise.name,
          );
          await click(summary);
        },
      });
      firstRows = await sessionRows(firstSession);
      startingHistory = await immutableHistory();
      assert.equal(complete.status, "COMPLETED");
      assert.equal(
        firstRows.length,
        firstDay.exercises.reduce(
          (sum, exercise) => sum + exercise.targetSets,
          0,
        ),
      );
      assert.deepEqual(
        firstRows.slice(0, 3).map((row) => row.repetitions),
        priorReps,
      );
      assert.ok(
        firstRows.every(
          (r) => r.load_unit === "KG" && r.rpe === null && r.rir === null,
        ),
      );
      assert.equal(await immutablePlans(), startingPlans);
      return {
        firstSession,
        sets: firstRows.length,
        widths: await sweep("resultado-entrenamiento"),
      };
    },
  );

  await check(
    "UI04 Progreso visualiza la serie real y abre la siguiente programación compatible",
    async () => {
      const exerciseId = firstDay.exercises[0].exercise.id;
      await navigate("Progreso");
      await waitProgress();
      await click("[data-testid=progress-period-all]");
      await waitProgress();
      await field("[data-testid=progress-plan]", planId);
      await waitProgress();
      await field("[data-testid=progress-plan-day]", firstDay.id);
      await field("[data-testid=progress-exercise]", exerciseId);
      await waitProgress();
      const actual = await api(
        "get",
        `/workout-sessions/progress?period=all&planId=${planId}&planDayId=${firstDay.id}&exerciseId=${exerciseId}`,
      );
      assert.equal(actual.estimates.length, 0);
      assert.equal(actual.series.length, 1);
      assert.equal(Number(actual.series[0].load), priorLoad);
      assert.ok(
        actual.series[0].points.every(
          ({ repetitions }) => repetitions === priorReps[2],
        ),
      );
      await waitVisible("svg[data-testid^=progress-]");
      await sweep("progreso-resultados-reales");
      const chart =
        '.progress-chart:has(svg[data-testid="progress-repetitions-chart"])';
      await waitVisible(chart + " [role=status]");
      assert.match(
        normalized(
          await sync(
            "return document.querySelector(arguments[0]).textContent",
            [chart + " [role=status]"],
          ),
        ),
        new RegExp(firstDate + ".*" + priorReps[2]),
      );
      const chartWidths = await sweep(
        "progreso-grafica-repeticiones",
        undefined,
        chart,
      );
      assert.equal(chartWidths.length, widths.length);
      await field("[data-testid=progress-plan-day]", secondDay.id);
      await field("[data-testid=progress-exercise]", exerciseId);
      await waitProgress();
      const nextGuide = `[data-testid=progress-next-guide] a[href*="${secondActivity.id}"]`;
      await waitVisible(nextGuide);
      await click(nextGuide);
      await until(
        () =>
          sync(
            'return new URL(location.href).searchParams.get("activityId")===arguments[0]&&document.querySelector(".daily-guide")?.getAttribute("aria-busy")==="false"',
            [secondActivity.id],
          ),
        "vista específica de la siguiente actividad",
      );
      assert.match(
        await sync('return document.querySelector("main").textContent'),
        /Legs A/,
      );
      const guide = await api(
        "get",
        "/progression/workout-guide?activityId=" + secondActivity.id,
      );
      const first = guide.exercises[0];
      assert.equal(first.guidanceSuggested.origin, "HISTORICAL_REFERENCE");
      assert.equal(
        Number(first.lastReference.sessions[0].sets[0].load),
        priorLoad,
      );
      assert.deepEqual(
        first.lastReference.sessions[0].sets.map((row) => row.repetitions),
        priorReps,
      );
      assert.equal(first.progressiveContext.ready, true);
      if (hotfix) {
        const card = await sync(
          'const e=document.querySelector(".guide-exercise");return {details:e.querySelectorAll("details").length,text:e.textContent}',
        );
        assert.equal(card.details, 1);
        assert.match(normalized(card.text), /60 kg.*12\s*[/]\s*11\s*[/]\s*9/i);
        assert.doesNotMatch(
          card.text,
          /HISTORY_REPETITIONS_INCONSISTENT|NO_ELIGIBLE_HISTORY|TARGET_UNIT_REQUIRED|INCREMENT_REQUIRED|SETTING_REQUIRED|60\.000/,
        );
      }
      await sweep("legs-a-programacion-detalle");
      await observeRequests();
      await click(".guide-exercise .repetition-preview-button");
      await until(
        () =>
          sync(
            'return document.querySelector(".guide-exercise .workout-preparation")?.dataset.stage==="REPETITION_DRAFT"',
          ),
        "orientación calculada únicamente tras confirmar",
      );
      const calculated = await sync(
        'return document.querySelector(".guide-exercise .preparation-draft").textContent',
      );
      assert.match(
        normalized(calculated),
        hotfix ? /60.*12\s*\/\s*11\s*\/\s*10/i : /40.*9/,
      );
      const previews = await sync(
        'return window.__prog7Requests.filter(r=>r.method==="POST"&&r.path.endsWith("/repetition-preview"))',
      );
      assert.equal(previews.length, 1);
      assert.equal(
        previews[0].body.policyContract,
        "session-repetition-preview-v2",
      );
      assert.equal(await immutableHistory(), startingHistory);
      assert.equal(await immutablePlans(), startingPlans);
      await shot(
        hotfix ? "legs-a-propuesta-60-kg-series" : "legs-a-propuesta-40-kg-9",
      );
      if (hotfix) {
        await sweep(
          "orientacion-60-kg-por-serie",
          undefined,
          ".guide-exercise",
        );
      }
      return {
        points: actual.series[0].points.length,
        nextActivity: secondActivity.id,
        previousPrescription: firstDay.exercises[0].id,
        nextPrescription: secondDay.exercises[0].id,
        calculated: normalized(calculated),
      };
    },
  );

  await check(
    "UI04b el mismo día respeta los cambios de fecha, actividad y zona del enlace",
    async () => {
      const dayRoute = `/app/routine/${planId}/weeks/${planning.weeks[1].id}/days/${secondDay.id}`;
      const invalidSelector = ".routine-start-panel [role=alert]";
      const alternativeZone =
        secondActivity.zone === "America/Lima"
          ? "Pacific/Honolulu"
          : "America/Lima";
      const link = (date, activity, timeZone) =>
        dayRoute +
        "?" +
        new URLSearchParams({ date, activityId: activity, timeZone });
      await observeRequests();
      for (const [date, activity, zone] of [
        [shift(-1), secondActivity.id, secondActivity.zone],
        [secondDate, firstActivity.id, secondActivity.zone],
        [secondDate, secondActivity.id, alternativeZone],
      ]) {
        await go(link(date, activity, zone));
        await waitVisible(invalidSelector);
        const state = await sync(`
          const panel = document.querySelector(".routine-start-panel");
          const field = document.querySelector("#routine-execution-date");
          return {
            alert: panel.querySelector("[role=alert]").textContent,
            date: field.value,
            dateLocked: field.disabled,
            hasStart: [...panel.querySelectorAll("button")].some(e=>!e.disabled&&/Empezar entrenamiento|Registrar entrenamiento de esta fecha/.test(e.textContent)),
          };
        `);
        assert.equal(state.date, date);
        assert.equal(state.dateLocked, true);
        assert.equal(state.hasStart, false);
        assert.match(state.alert, /programación.*no está disponible/s);
      }
      await shot("legs-a-zona-equivocada-inicio-bloqueado");
      await go(link(secondDate, secondActivity.id, secondActivity.zone));
      await until(
        () =>
          sync(
            'return !document.querySelector(".routine-start-panel [role=alert]")&&document.querySelector(".daily-guide")?.getAttribute("aria-busy")==="false"',
          ),
        "programación recuperada para el enlace válido",
      );
      assert.match(
        await sync(
          'return document.querySelector("[for=routine-execution-date]").textContent',
        ),
        new RegExp(secondActivity.zone),
      );
      const starts = await sync(
        'return window.__prog7Requests.filter(r=>r.method==="POST"&&r.path.endsWith("/workout-sessions"))',
      );
      assert.deepEqual(starts, []);
      assert.equal(await immutableHistory(), startingHistory);
      return {
        rejected: ["date", "activityId", "timeZone"],
        verifiedZone: secondActivity.zone,
        starts: starts.length,
      };
    },
  );

  await check(
    "UI05 inicio actual conserva fecha/zona y el borrador editable solo se registra al confirmar",
    async () => {
      if (secondDate > today) {
        await navigate("Mi plan");
        await field("#routine-week", planning.weeks[1].id);
        if (
          !(await sync(
            'return document.querySelector(".routine-options")?.open',
          ))
        )
          await click(".routine-options > summary");
        await field("#calendar-date", today);
        const move = `.routine-calendar li:has(a[href*="${secondActivity.id}"]) .plan-actions button`;
        await waitVisible(move);
        await textClick(move, "Mover a " + today);
        await until(
          async () => (await activityFor(secondDay.id)).date === today,
          "movido por control visible",
        );
        secondActivity = await activityFor(secondDay.id);
      }
      await calendar(today);
      secondSession = await startCalendar(
        secondActivity,
        "Comenzar entrenamiento",
      );
      const done = await recordWholeSession(secondSession, {
        offset: priorLoad - 39,
        reps: 10,
        beforeFirstSet: async () => {
          const preparation = ".workout-live .workout-preparation";
          await until(
            () =>
              sync(
                'return ["REPETITION_READY","REPETITION_DRAFT"].includes(document.querySelector(arguments[0])?.dataset.stage)',
                [preparation],
              ),
            "contexto compatible en el registro real",
          );
          if (
            await sync(
              'return document.querySelector(arguments[0]).dataset.stage==="REPETITION_READY"',
              [preparation],
            )
          ) {
            const calculates = await sync(
              'return !!document.querySelector(".workout-live .repetition-preview-button:not(:disabled)")',
            );
            if (calculates)
              await click(".workout-live .repetition-preview-button");
          }
          await until(
            () =>
              sync(
                'return document.querySelector(".quick-set-form input[id$=-load]")?.value===arguments[0]&&document.querySelector(".quick-set-form input[id$=-reps]")?.value===arguments[1]',
                [String(priorLoad), String(nextReps[0])],
              ),
            "borrador calculado editable",
          );
          await field('.quick-set-form input[id$="-load"]', priorLoad + 1);
          await field('.quick-set-form input[id$="-reps"]', 10);
          assert.equal(await immutableHistory(), startingHistory);
          assert.equal(await immutablePlans(), startingPlans);
          assert.deepEqual(await sessionRows(secondSession), []);
          await sync(
            "document.querySelector('.quick-set-form').scrollIntoView({block:'center'})",
          );
          await health(
            hotfix
              ? "registro-borrador-61-kg-10"
              : "registro-borrador-41-kg-10-sin-guardar",
          );
        },
        beforeSet: async (index, n) => {
          if (!hotfix || index !== 0 || n === 1) return;
          await until(
            () =>
              sync(
                'return document.querySelector(".quick-set-form input[id$=-load]")?.value==="60"&&document.querySelector(".quick-set-form input[id$=-reps]")?.value===arguments[0]',
                [String(nextReps[n - 1])],
              ),
            "borrador conservado en serie de trabajo " + n,
          );
        },
      });
      const actual = await sessionRows(secondSession);
      assert.equal(done.status, "COMPLETED");
      assert.equal(Number(actual[0].load), priorLoad + 1);
      assert.equal(actual[0].repetitions, 10);
      assert.ok(actual.every((row) => row.rpe === null && row.rir === null));
      assert.deepEqual(await sessionRows(firstSession), firstRows);
      assert.equal(await immutablePlans(), startingPlans);
      const {
        rows: [automatic],
      } = await sql.query(
        "SELECT (SELECT count(*) FROM progression_recommendations WHERE athlete_id=$1)::int AS proposals,(SELECT count(*) FROM progression_applications WHERE athlete_id=$1)::int AS applications,(SELECT count(*) FROM progression_automation_consents WHERE athlete_id=$1)::int AS consents",
        [athleteId],
      );
      assert.deepEqual(automatic, {
        proposals: 0,
        applications: 0,
        consents: 0,
      });
      return {
        secondSession,
        sets: actual.length,
        draft: [priorLoad, ...(hotfix ? nextReps : nextReps.slice(0, 1))],
        written: [priorLoad + 1, 10],
        automatic,
      };
    },
  );

  await check(
    "UI06 navegación en cuatro tamaños, teclado y movimiento reducido",
    async () => {
      const evidence = {};
      const pages = [
        ["inicio", "/app/overview", ".weekly-training"],
        ["mi-plan", `/app?planId=${planId}`, ".routine-current"],
        [
          "progreso",
          "/app/progression",
          "[data-testid=progress-overview][aria-busy=false]",
        ],
        ["entrenar", "/app/workouts", "main h1"],
        ["historial", "/app/history", "main h1"],
        ["perfil", "/app/profile", "main h1"],
        ["ejercicios", "/app/exercises", "main h1"],
        ["planificacion", "/app/training-plans", "main h1"],
        ["ajustes", "/app/progression/settings", "main h1"],
        ["automatizacion", "/app/progression/automation", "main h1"],
      ];
      for (const [page, route, ready] of pages) {
        await go(route);
        await waitVisible(ready);
        evidence[page] = await sweep(page, async () => {
          const state = await sync(`
          const nav = document.querySelector(".app-bottom-nav");
          const links = [...(nav?.querySelectorAll("a") ?? [])];
          return {
            mobile: matchMedia("(max-width: 900px)").matches,
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
            navVisible: !!nav?.getClientRects().length,
            current: links.filter((link) => link.getAttribute("aria-current")==="page").length,
            labels: links.map((link) => link.textContent.replace(/\\s+/g, " ").trim()),
          };
        `);
          assert.equal(state.reduced, true);
          assert.equal(state.navVisible, state.mobile);
          if (state.mobile) {
            assert.equal(state.current, 1);
            assert.deepEqual(state.labels.sort(), [
              "Entrenar",
              "Inicio",
              "Mi plan",
              "Perfil",
              "Progreso",
            ]);
          }
        });
      }
      await go("/app/progression");
      await waitProgress();
      await click("[data-testid=progress-period-all]");
      await field(
        "[data-testid=progress-exercise]",
        firstDay.exercises[0].exercise.id,
      );
      await waitProgress();
      const loadChart =
        '.progress-chart:has(svg[data-testid="progress-load-chart-KG"])';
      const firstPoint = loadChart + " .observations button:first-child";
      await waitVisible(firstPoint);
      const isSelected = () =>
        sync(
          "return document.querySelector(arguments[0]).getAttribute('aria-pressed')",
          [firstPoint],
        );
      assert.equal(await isSelected(), "false");
      await sync("document.querySelector(arguments[0]).focus()", [firstPoint]);
      await keyboard("");
      assert.equal(await isSelected(), "true");
      assert.match(
        normalized(
          await sync(
            "return document.querySelector(arguments[0]).textContent",
            [loadChart + " [role=status]"],
          ),
        ),
        new RegExp(firstDate + ".*" + priorLoad),
      );
      await health("progreso-grafica-carga-teclado-390");
      await navigate("Inicio");
      await waitVisible(".weekly-training");
      await sync('document.querySelector(".mobile-menu-button").focus()');
      await keyboard("\uE007");
      await until(
        () =>
          sync(
            'return document.activeElement?.getAttribute("aria-label")==="Cerrar menú"&&!!document.querySelector(".app-sidebar[aria-modal=true]")',
          ),
        "apertura del diálogo por teclado y foco inicial",
      );
      assert.equal(
        await sync(
          'return document.querySelector("main").closest("[inert]")!==null',
        ),
        true,
      );
      await keyboard("\uE008", "\uE004");
      assert.equal(
        await sync(
          'return !!document.activeElement.closest(".app-sidebar")&&document.activeElement.getAttribute("aria-label")!=="Cerrar menú"',
        ),
        true,
      );
      await keyboard("\uE004");
      assert.equal(
        await sync('return document.activeElement.getAttribute("aria-label")'),
        "Cerrar menú",
      );
      await shot("menu-movil-foco-confinado");
      await keyboard("\uE00C");
      await until(
        () =>
          sync(
            'return document.activeElement.matches(".mobile-menu-button")&&!document.querySelector(".app-sidebar[aria-modal=true]")',
          ),
        "Escape cierra el diálogo y devuelve el foco",
      );
      await click(".mobile-menu-button");
      await waitForDrawer();
      await textClick(".app-sidebar a", "Inicio");
      await until(
        () =>
          sync(
            'return !document.querySelector(".app-sidebar[aria-modal=true]")',
          ),
        "el enlace a la página actual cierra el menú",
      );
      await sync('document.querySelector(".pulso-skip").focus()');
      await keyboard("\uE007");
      assert.equal(
        await sync("return document.activeElement.id"),
        "main-content",
      );
      return {
        widthsByPage: evidence,
        drawer: "Enter, Shift+Tab, Tab, Escape",
        skipLink: true,
      };
    },
  );

  await check(
    "UI07 Progreso muestra carga, error recuperable y resultados reales después de reintentar",
    async () => {
      await go("/app/overview");
      await sync(`
      const proto = XMLHttpRequest.prototype, open = proto.open, send = proto.send;
      window.__uiFinalProgressMode = "hold";
      window.__uiFinalRelease = null;
      window.__uiFinalRestore = () => { proto.open = open; proto.send = send; };
      const progressRequest = Symbol();
      proto.open = function(method, url, ...rest) {
        this[progressRequest] = method === "GET" && new URL(url, location.href).pathname.endsWith("/workout-sessions/progress");
        return open.call(this, method, url, ...rest);
      };
      proto.send = function(...args) {
        if (this[progressRequest] && window.__uiFinalProgressMode === "hold") {
          window.__uiFinalRelease = () => send.apply(this, args);
          return;
        }
        if (this[progressRequest] && window.__uiFinalProgressMode === "error") {
          queueMicrotask(() => this.dispatchEvent(new ProgressEvent("error")));
          return;
        }
        return send.apply(this, args);
      };
    `);
      await navigate("Progreso");
      await waitVisible(
        "[data-testid=progress-overview][aria-busy=true] [role=status]",
      );
      await until(
        () => sync("return typeof window.__uiFinalRelease === 'function'"),
        "solicitud real detenida",
      );
      await shot("progreso-cargando");
      await sync(
        'window.__uiFinalProgressMode="error";window.__uiFinalRelease()',
      );
      await waitProgress();
      await click("[data-testid=progress-period-all]");
      await waitVisible("[data-testid=progress-overview] [role=alert]");
      await shot("progreso-error-reintento");
      await sync("window.__uiFinalRestore()");
      await textClick(
        "[data-testid=progress-overview] [role=alert] button",
        "Reintentar",
      );
      await waitProgress();
      assert.equal(
        await sync(
          'return !!document.querySelector("[data-testid=progress-overview] [role=alert]")',
        ),
        false,
      );
      await health("progreso-reintento-exitoso");
      return {
        loading: true,
        networkErrorInjectedThroughBrowser: true,
        retryRestoredRealResults: true,
      };
    },
  );

  await check(
    "UI08 todas las verificaciones responsivas del recorrido",
    async () => {
      assert.deepEqual(visualFaults, []);
      return { widths: widths.map(([width]) => width) };
    },
  );
}
