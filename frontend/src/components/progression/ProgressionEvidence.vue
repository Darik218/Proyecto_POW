<script setup lang="ts">
import StatusBadge from '../ui/StatusBadge.vue'
import type { ProgressionPreview } from '../../types/progression'
defineProps<{ value: ProgressionPreview }>()
</script>
<template>
  <section class="progression-card progression-evidence" aria-label="Evidencia de la propuesta">
    <div class="progression-section-heading"><h2>Propuesta calculada</h2><StatusBadge :status="value.decision" /></div>
    <div class="progression-load-comparison">
      <div><span>Carga de referencia</span><strong>{{ value.increment?.currentLoad ?? 'Sin carga' }} <small>{{ value.increment?.unit ?? 'Unidad desconocida' }}</small></strong></div>
      <span aria-hidden="true">→</span>
      <div><span>Carga propuesta</span><strong>{{ value.increment?.proposedLoad ?? 'Sin incremento' }} <small>{{ value.increment?.unit ?? 'Unidad desconocida' }}</small></strong></div>
    </div>
    <p>
      Incremento solicitado:
      {{ value.increment?.requestedDelta ?? 'No evaluable' }}. Límite de carga:
      {{ value.increment?.allowedUpperLoad ?? 'No evaluable' }}.
    </p>
    <p>
      Período: {{ value.period.start }} a {{ value.period.endExclusive }} (fin
      exclusivo). Corte: {{ value.period.cutoffOn }} ·
      {{ value.period.timeZone }}. Semana
      {{ value.period.closed ? 'cerrada' : 'abierta' }}.
    </p>
    <p>
      Destino: plan {{ value.destination.planId ?? 'No asociado' }} · semana
      {{ value.destination.weekId ?? 'No asociada' }} · día
      {{ value.destination.dayId ?? 'No asociado' }} · prescripción
      {{ value.destination.prescriptionId ?? 'No asociada' }}. Versión
      {{ value.destination.planVersion ?? 'Desconocida' }} ·
      {{ value.destination.planStatus ?? 'Sin estado' }}.
    </p>
    <p
      v-for="reason in value.reasons"
      :key="reason"
      class="progression-warning"
    >
      {{ reason }}
    </p>
    <details>
      <summary>Política y condiciones matemáticas</summary>
      <dl v-if="value.configuration.policy">
        <dt>Política</dt>
        <dd>
          {{ value.configuration.policy.id }} ·
          {{ value.configuration.policy.version }} ·
          {{ value.configuration.policy.provenance.reference }}
        </dd>
        <dt>Base / carga de referencia</dt>
        <dd>
          {{ value.configuration.policy.basis }} /
          {{ value.configuration.policy.baseline }}
        </dd>
        <dt>Conteo</dt>
        <dd>
          {{ value.configuration.policy.assessment.count?.criterion }} ·
          {{ value.configuration.policy.assessment.count?.mode }} · mínimo
          {{ value.configuration.policy.assessment.count?.minimumSessions }}
        </dd>
        <dt>Readiness</dt>
        <dd>
          {{ value.configuration.policy.assessment.compliance?.readiness }}
        </dd>
        <dt>Revisión por señales</dt>
        <dd>{{ value.configuration.policy.review }}</dd>
        <dt>Incremento / rejilla</dt>
        <dd>
          {{ value.configuration.policy.incrementMode }} · paso
          {{ value.configuration.policy.grid.step }}
          {{ value.configuration.policy.grid.unit }} · origen
          {{ value.configuration.policy.grid.origin }} ·
          {{ value.configuration.policy.grid.rounding }}
        </dd>
      </dl>
      <p v-else>No hay política operativa completa.</p>
      <p v-for="reason in value.configuration.reasons" :key="reason">
        {{ reason }}
      </p>
    </details>
    <section class="progression-evidence-section">
    <h3>Cumplimiento y cobertura</h3>
    <dl class="progression-metrics">
      <div><dt>Sesiones únicas</dt><dd>{{ value.evidence.coverage.uniqueSessions }}</dd></div>
      <div><dt>Ejercicios analizados</dt><dd>{{ value.evidence.coverage.tasksReturned }}</dd></div>
      <div><dt>Series revisadas</dt><dd>{{ value.evidence.coverage.reviewedSets }}</dd></div>
    </dl>
    <p>
      Sesiones: {{ value.evidence.coverage.uniqueSessions }}; ejercicios:
      {{ value.evidence.coverage.tasksReturned }}; series revisadas:
      {{ value.evidence.coverage.reviewedSets }}. Historial limitado:
      {{
        Object.values(value.evidence.coverage.truncated).some(Boolean)
          ? 'Sí'
          : 'No'
      }}.
    </p>
    <p>
      Sesiones satisfactorias:
      {{ value.evidence.satisfactory?.qualifyingCount ?? 'No evaluable' }} ·
      mínimo alcanzado:
      {{ value.evidence.satisfactory?.meetsMinimum ?? 'No evaluable' }}.
    </p>
    <article
      v-for="t in value.evidence.tasks"
      :key="t.id"
      class="progression-card"
    >
      <h3>
        {{ t.performedOn ?? 'Fecha desconocida' }} · ejercicio ejecutado
        {{ t.id }}
      </h3>
      <p v-if="t.isOmitted">Ejercicio omitido</p>
      <dl class="progression-target-comparison">
        <dt>Objetivo original</dt>
        <dd>
          {{ t.original.targetSets ?? '?' }} series ·
          {{ t.original.targetRepsMin ?? '?' }}–{{
            t.original.targetRepsMax ?? '?'
          }}
          rep · {{ t.original.targetLoad ?? '?' }}
          {{ t.original.targetLoadUnit ?? 'Unidad desconocida' }} · RPE
          {{ t.original.targetRpe ?? 'Ausente' }}
        </dd>
        <dt>Objetivo ajustado</dt>
        <dd>
          {{ t.adjusted.targetSets ?? '?' }} series ·
          {{ t.adjusted.targetRepsMin ?? '?' }}–{{
            t.adjusted.targetRepsMax ?? '?'
          }}
          rep · {{ t.adjusted.targetLoad ?? '?' }}
          {{ t.adjusted.targetLoadUnit ?? 'Unidad desconocida' }} · RPE
          {{ t.adjusted.targetRpe ?? 'Ausente' }}
        </dd>
      </dl>
      <h4>Resultados ejecutados</h4>
      <ul>
        <li
          v-for="s in value.evidence.sets.filter(
            (s) => s.workoutExerciseId === t.id,
          )"
          :key="s.id"
        >
          Serie {{ s.setNumber }} · {{ s.status ?? 'Estado desconocido' }} ·
          {{ s.kind ?? 'Tipo desconocido' }} · {{ s.repetitions ?? '?' }} rep ·
          {{ s.load ?? '?' }} {{ s.loadUnit ?? 'Unidad desconocida' }} · RPE
          {{ s.rpe ?? 'Ausente' }}
        </li>
      </ul>
      <div
        class="progression-readiness"
        v-for="a in value.evidence.assessments.filter((a) => a.taskId === t.id)"
        :key="a.taskId"
      >
        <p>
          Cumplimiento original: {{ a.original.basic }} · readiness:
          {{ a.original.readiness }}.
        </p>
        <p>
          Cumplimiento ajustado: {{ a.adjusted.basic }} · readiness:
          {{ a.adjusted.readiness }} · cobertura RPE:
          {{ a.adjusted.rpeCoverage ?? '?' }}%.
        </p>
        <p v-for="r in [...a.original.reasons, ...a.adjusted.reasons]" :key="r">
          {{ r }}
        </p>
      </div>
    </article>
    </section><section class="progression-evidence-section">
    <h3>RPE y señales descriptivas</h3>
    <p>
      Las señales heurísticas no son un diagnóstico fisiológico ni una
      autorización automática.
    </p>
    <p v-if="!value.evidence.signals.length">
      No hay señales evaluables bajo la política actual.
    </p>
    <p v-for="s in value.evidence.signals" :key="s.taskId">
      {{ s.status }} · RPE actual {{ s.currentRpe ?? '?' }}; referencia
      {{ s.referenceRpe ?? '?' }}; diferencia {{ s.deltaRpe ?? '?' }}. Señal:
      {{ s.reviewSignal ?? 'No evaluable' }}. {{ s.reasons.join(', ') }}
    </p>
    <p>
      Persistencia de señal:
      {{
        value.evidence.temporalSignals?.persistentReviewSignal ??
        'No evaluable'
      }}.
    </p>
    </section><section class="progression-evidence-section">
    <h3>1RM estimado descriptivo</h3>
    <p>
      No equivale a una medición del máximo real ni a evidencia oficial
      verificada.
    </p>
    <p v-if="!value.evidence.oneRm.points.length">
      Sin estimaciones descriptivas utilizables.
    </p>
    <p v-for="p in value.evidence.oneRm.points" :key="p.id">
      {{ p.formula }} · {{ p.resultKg }} KG ·
      {{ p.evidenceStatus ?? 'Evidencia desconocida' }} ·
      {{ p.warnings.join(', ') }}
    </p>
    </section><section class="progression-evidence-section">
    <h3>Exclusiones</h3>
    <p v-if="!value.evidence.excludedTasks.length">
      No se informaron exclusiones adicionales.
    </p>
    <p v-for="t in value.evidence.excludedTasks" :key="t.taskId">
      {{ t.taskId }} · {{ t.reasons.join(', ') }}
    </p>
    </section><p class="progression-warning">
      Una propuesta guardada no autoriza su aplicación. Aprobar y aplicar son
      decisiones separadas.
    </p>
  </section>
</template>
