import { createHash } from 'node:crypto';
import { readDecimal } from './decimal';
import { RecommendationError } from '../../models/progression/recommendation-draft.model';
const collections = new Set([
  'original',
  'adjusted',
  'tasks',
  'sets',
  'observedSets',
  'contexts',
  'comparisons',
  'strictComparisons',
  'signals',
  'slots',
  'points',
  'groups',
  'excluded',
  'reasons',
  'warnings',
  'taskIds',
  'sourceTaskIds',
  'referenceTaskIds',
  'positions',
  'excludedSetIds',
  'includedSetIds',
  'nonEvaluableSetIds',
]);
const numeric = new Set([
  'load',
  'loadKg',
  'rpe',
  'targetLoad',
  'targetRpe',
  'minimum',
  'maximum',
  'incrementAbsolute',
  'incrementPercent',
  'maxIncrementPercent',
  'maxLoad',
  'step',
  'origin',
  'rpeThreshold',
  'performanceThresholdPercent',
  'minimumRpeCoveragePercent',
  'resultKg',
  'inputLoad',
  'inputLoadKg',
  'delta',
  'value',
  'loadDifferenceKg',
  'targetLoadKg',
  'rpeValue',
  'percent',
  'deltaRpe',
  'deltaPerformancePercent',
  'coveragePercent',
  'currentRpe',
  'referenceRpe',
  'currentPerformance',
  'referencePerformance',
  'proposedLoad',
  'proposedLoadKg',
  'requestedDelta',
  'allowedUpperLoad',
  'result',
  'deltaKg',
  'deltaPercent',
]);
export function recommendationIdentity(value: unknown): string {
  const canonical = (v: unknown, key = ''): string => {
    if (v === undefined) return '["absent"]';
    if (v === null) return '["null"]';
    if (typeof v === 'number') {
      if (!Number.isFinite(v))
        throw new RecommendationError('NUMERIC_INPUT_INVALID');
      const d = numeric.has(key) ? readDecimal(String(v)) : null;
      return JSON.stringify([
        d?.ok ? 'decimal' : 'number',
        d?.ok ? d.value.toFixed() : String(v),
      ]);
    }
    if (typeof v === 'boolean') return JSON.stringify(['boolean', v]);
    if (typeof v === 'string') {
      const d = numeric.has(key) ? readDecimal(v) : null;
      return JSON.stringify([
        d?.ok ? 'decimal' : 'string',
        d?.ok ? d.value.toFixed() : v,
      ]);
    }
    if (Array.isArray(v)) {
      const items = v.map((x) => canonical(x, key));
      if (collections.has(key)) items.sort();
      return '["array",' + items.join(',') + ']';
    }
    if (typeof v === 'object')
      return (
        '["object",' +
        Object.keys(v)
          .sort()
          .map(
            (k) =>
              JSON.stringify(k) +
              ':' +
              canonical((v as Record<string, unknown>)[k], k),
          )
          .join(',') +
        ']'
      );
    throw new RecommendationError('INVALID_COMMAND');
  };
  return createHash('sha256')
    .update('prog-4a-semantic-v1\n' + canonical(value))
    .digest('hex');
}

// The existing PROG-4A fingerprints, shared verbatim by generation and storage.
export function recommendationDependencyKeys(evidence: {
  engineVersion: string;
  configuration: unknown;
  period: unknown;
  historyWindow: unknown;
  destination: unknown;
  source: unknown;
  assessment: unknown;
  oneRm: unknown;
  coverage: unknown;
  excludedTasks: unknown;
}) {
  return {
    configuration: recommendationIdentity({
      engineVersion: evidence.engineVersion,
      settings: evidence.configuration,
    }),
    period: recommendationIdentity({
      week: evidence.period,
      historyWindow: evidence.historyWindow,
    }),
    destination: recommendationIdentity(evidence.destination),
    evidence: recommendationIdentity({
      source: evidence.source,
      assessment: evidence.assessment,
      estimates: evidence.oneRm,
      coverage: evidence.coverage,
      excludedTasks: evidence.excludedTasks,
    }),
  };
}
