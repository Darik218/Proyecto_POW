<script setup lang="ts">
import type { ConsentSnapshot } from "../../types/automation-consent";
defineProps<{ value: ConsentSnapshot; title?: string }>();
</script>
<template>
  <section class="progression-card progression-conditions">
    <h2>{{ title ?? "Condiciones exactas de la solicitud" }}</h2>
    <p>
      Ejercicio {{ value.contract.exerciseId }} · plan
      {{
        value.contract.trainingPlanId ??
        "Sin plan global: únicamente los identificadores elegidos"
      }}.
    </p>
    <p class="progression-warning">
      Esta captura histórica de configuración conserva la marca de aceptación
      humana original: NOT_RECORDED. Una aceptación posterior se acredita
      mediante su evento separado, sin reescribir esta captura. Esta captura no
      acredita autorización operativa; consulta el permiso operativo actual por
      separado.
    </p>
    <dl class="progression-contract-grid">
      <dt>Vigencia [inicio, fin)</dt>
      <dd>
        {{ value.contract.validity.startsAt }} →
        {{ value.contract.validity.endsAt }} ·
        {{ value.contract.validity.timeZone }}
      </dd>
      <dt>Límites</dt>
      <dd>
        Incremento absoluto máximo
        {{ value.contract.limits.maximumAbsoluteIncrement }}
        {{ value.contract.limits.unit }}; porcentual
        {{ value.contract.limits.maximumPercentIncrement }}%; carga máxima
        {{ value.contract.limits.maximumLoad }}
        {{ value.contract.limits.unit }}; hasta
        {{ value.contract.limits.maximumApplicationsPerWeek }} aplicaciones por
        semana; inicio ISO {{ value.contract.limits.weekStartsOn }}; ventana
        histórica {{ value.contract.historyWindowDays }} días.
      </dd>
      <dt>Interpretación de carga</dt>
      <dd>
        {{ value.contract.limits.loadMeaning }}. Sin conversión automática de
        unidad.
      </dd>
      <dt>Política y versiones</dt>
      <dd>
        {{ value.contract.policy.id }} · {{ value.contract.policy.version }} ·
        {{ value.contract.policy.provenance.reference }}. Motor
        {{ value.engine.recommendation }}; numérica {{ value.engine.numeric }};
        condiciones {{ value.contract.termsVersion }}.
      </dd>
      <dt>Alcance</dt>
      <dd>
        {{ value.contract.selector.kind }} ·
        {{ value.contract.selector.planState }} ·
        {{ value.contract.selector.versionPolicy }}. Solo futuros:
        {{ value.contract.selector.futureOnly }}.
      </dd>
      <dt>Base de evaluación</dt>
      <dd>
        {{ value.contract.policy.basis }} ·
        {{ value.contract.policy.baseline }} ·
        {{ value.contract.policy.cohort.mode }}
      </dd>
      <dt>Criterios de cumplimiento</dt>
      <dd>{{ value.contract.policy.assessment.compliance?.basic }}</dd>
      <dt>Readiness y RPE</dt>
      <dd>
        {{ value.contract.policy.assessment.compliance?.readiness }} · intervalo
        configurado {{ value.contract.policy.settingRpeUse }}
      </dd>
      <dt>Conteo de sesiones</dt>
      <dd>{{ value.contract.policy.assessment.count }}</dd>
      <dt>Señales y persistencia</dt>
      <dd>
        {{ value.contract.policy.review }} ·
        {{
          value.contract.policy.assessment.signal ?? "Sin política de señales"
        }}
        ·
        {{
          value.contract.policy.assessment.persistence ??
          "Sin política temporal"
        }}. No constituye diagnóstico fisiológico.
      </dd>
      <dt>Incremento y rejilla</dt>
      <dd>
        {{ value.contract.policy.incrementMode }} · paso
        {{ value.contract.policy.grid.step }}
        {{ value.contract.policy.grid.unit }} · origen
        {{ value.contract.policy.grid.origin }} ·
        {{ value.contract.policy.grid.rounding }} ·
        {{ value.contract.policy.grid.source }}
      </dd>
      <dt>Información y restricciones</dt>
      <dd>
        {{ value.contract.policy.knowledge }} · semana cerrada requerida
        {{ value.contract.policy.requireClosedWeek }} · 1RM
        {{ value.contract.policy.oneRm }} (descriptivo).
      </dd>
      <dt>Procedencia</dt>
      <dd>
        {{ value.contract.provenance.source }} ·
        {{ value.contract.provenance.reference }}
      </dd>
    </dl>
    <section class="progression-evidence-section"><h3>Prescripciones exactas</h3>
    <ul>
      <li v-for="id in value.contract.selector.prescriptionIds" :key="id">
        {{ id }} · plan
        {{ value.destinations.find((d) => d.prescriptionId === id)?.planId }} ·
        semana
        {{ value.destinations.find((d) => d.prescriptionId === id)?.weekId }} ·
        día
        {{ value.destinations.find((d) => d.prescriptionId === id)?.dayId }} ·
        versión capturada
        {{
          value.destinations.find((d) => d.prescriptionId === id)
            ?.recordedPlanVersion
        }}
      </li>
    </ul>
    </section><section class="progression-evidence-section"><h3>Configuraciones capturadas</h3>
    <p v-for="b in value.bindings" :key="b.planId">
      Plan {{ b.planId }} · mínimo
      {{ b.selected?.minSuccessfulSessions ?? "?" }} sesiones · RPE
      {{ b.selected?.targetRpeMin ?? "?" }}–{{
        b.selected?.targetRpeMax ?? "?"
      }}
      · incremento absoluto {{ b.selected?.incrementAbsolute ?? "No definido" }}
      {{ value.contract.limits.unit }} · porcentual
      {{ b.selected?.incrementPercent ?? "No definido" }}% · límite porcentual
      {{ b.selected?.maxIncrementPercent ?? "?" }}% · carga máxima
      {{ b.selected?.maxLoad ?? "No definida" }}
      {{ value.contract.limits.unit }}.
    </p>
    </section><details>
      <summary>Posiciones y referencias de evidencia</summary>
      <p
        v-for="s in value.contract.policy.assessment.compliance?.slots"
        :key="s.taskId"
      >
        {{ s.taskId }} · originales {{ s.original.join(", ") }} · ajustadas
        {{ s.adjusted.join(", ") }} · interpretación
        {{ s.originalLoadMeaning ?? "Desconocida" }} /
        {{ s.adjustedLoadMeaning ?? "Desconocida" }}
      </p>
    </details>
    <p>
      Duplicar planes no amplía este alcance. Cambiar configuración no modifica
      esta versión. Una revisión genera otro evento; revocar no elimina el
      historial. Ninguna condición presentada activa todavía la ejecución.
    </p>
  </section>
</template>
