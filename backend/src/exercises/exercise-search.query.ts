import { Prisma } from '../generated/prisma/client';
import type { ExercisePage } from './exercises.repository';
// Columns are selected from a server-side allowlist; all user values remain bound parameters.
export function exerciseSearchQuery(
  query: ExercisePage,
  scope: 'GLOBAL' | 'PERSONAL' | 'VISIBLE',
  ownerId?: string,
  normalizedTerm?: string,
) {
  const conditions: Prisma.Sql[] = [Prisma.sql`e.is_active=true`];
  conditions.push(
    scope === 'GLOBAL'
      ? Prisma.sql`e.origin='GLOBAL'`
      : scope === 'PERSONAL'
        ? Prisma.sql`e.origin='PERSONAL' AND e.owner_id=${ownerId}::uuid`
        : Prisma.sql`(e.origin='GLOBAL' OR (e.origin='PERSONAL' AND e.owner_id=${ownerId}::uuid))`,
  );
  if (query.origin) conditions.push(Prisma.sql`e.origin::text=${query.origin}`);
  const columns = {
    equipmentType: 'equipment_type',
    machineType: 'machine_type',
    resistanceType: 'resistance_type',
    movementType: 'movement_type',
    movementPattern: 'movement_pattern',
    difficulty: 'difficulty',
  } as const;
  for (const key of Object.keys(columns) as Array<keyof typeof columns>)
    if (query[key])
      conditions.push(
        Prisma.sql`${Prisma.raw('e.' + columns[key])}::text=${query[key]}`,
      );
  if (query.primaryMuscleGroupKey)
    conditions.push(
      Prisma.sql`EXISTS(SELECT 1 FROM muscle_groups g WHERE g.id=e.primary_muscle_group_id AND g.key=${query.primaryMuscleGroupKey})`,
    );
  if (query.secondaryMuscleGroupKey)
    conditions.push(
      Prisma.sql`EXISTS(SELECT 1 FROM exercise_secondary_muscle_groups s JOIN muscle_groups g ON g.id=s.muscle_group_id WHERE s.exercise_id=e.id AND g.key=${query.secondaryMuscleGroupKey})`,
    );
  if (query.selection === 'FEATURED')
    conditions.push(Prisma.sql`e.featured_rank IS NOT NULL`);
  const recentJoin =
    query.selection === 'RECENT' && ownerId
      ? Prisma.sql`JOIN (SELECT w.exercise_id,max(s.recorded_at) AS recent_at FROM workout_exercises w JOIN workout_sessions ws ON ws.id=w.session_id JOIN athletes at ON at.id=ws.athlete_id JOIN set_records s ON s.workout_exercise_id=w.id WHERE at.user_id=${ownerId}::uuid AND (s.is_completed OR s.status IN ('INCOMPLETE','FAILED')) GROUP BY w.exercise_id) recent ON recent.exercise_id=e.id`
      : Prisma.empty;
  const recent =
    query.selection === 'RECENT' && ownerId
      ? Prisma.sql`recent.recent_at`
      : Prisma.sql`NULL::timestamptz`;
  if (query.selection === 'RECENT' && !ownerId)
    conditions.push(Prisma.sql`false`);
  // Normalize once in PostgreSQL; expand bound token patterns so GIN can serve both partial and fuzzy branches.
  const phrase =
    normalizedTerm === undefined
      ? Prisma.sql`pulso_search_normalize(${query.search ?? ''})`
      : Prisma.sql`${normalizedTerm}::text`;
  const tokens = (
    normalizedTerm ??
    (query.search ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  )
    .split(' ')
    .filter(Boolean);
  const terms = (column: Prisma.Sql) =>
    tokens.length
      ? Prisma.join(
          tokens.map(
            (token) => Prisma.sql`${column} LIKE ${'%' + token + '%'}`,
          ),
          ' AND ',
        )
      : Prisma.sql`false`;
  const match = (column: Prisma.Sql) =>
    Prisma.sql`(q.term<>'' AND (${column} LIKE '%'||q.term||'%' OR (${terms(column)}) OR (length(q.term)>=3 AND q.term <% ${column})))`;
  const rank = (column: Prisma.Sql, exact: number) =>
    Prisma.sql`CASE WHEN ${column}=q.term THEN ${exact} WHEN ${column} LIKE q.term||'%' THEN 2 WHEN ${column} LIKE '%'||q.term||'%' THEN 3 WHEN ${terms(column)} THEN 4 ELSE 5 END`;
  const name = Prisma.sql`e.search_name`,
    alias = Prisma.sql`a.normalized_name`;
  const matches = query.search?.trim()
    ? Prisma.sql`matches AS (SELECT e.id,${rank(name, 0)} AS rank,word_similarity(q.term,e.search_name) AS score FROM exercises e CROSS JOIN q WHERE ${match(name)} UNION ALL SELECT a.exercise_id,${rank(alias, 1)},word_similarity(q.term,a.normalized_name) FROM exercise_aliases a CROSS JOIN q WHERE ${match(alias)} UNION ALL SELECT e.id,6,0::real FROM exercises e CROSS JOIN q WHERE length(q.term)>=3 AND (${terms(Prisma.sql`e.search_description`)})), ranked AS (SELECT id,min(rank) rank,max(score) score FROM matches GROUP BY id),`
    : Prisma.empty;
  const join = query.search?.trim()
    ? Prisma.sql`JOIN ranked r ON r.id=e.id`
    : Prisma.empty;
  const cte = Prisma.sql`WITH q AS (SELECT ${phrase} AS term),${matches} visible AS (SELECT e.id,e.name,e.featured_rank,${recent} AS recent_at ${query.search?.trim() ? Prisma.sql`,r.rank,r.score` : Prisma.empty} FROM exercises e ${join} ${recentJoin} WHERE ${Prisma.join(conditions, ' AND ')})`;
  const finalOrder = query.search?.trim()
    ? Prisma.sql`rank ASC,score DESC,name ASC,id ASC`
    : query.selection === 'RECENT'
      ? Prisma.sql`recent_at DESC,name ASC,id ASC`
      : query.selection === 'FEATURED'
        ? Prisma.sql`featured_rank ASC,name ASC,id ASC`
        : Prisma.sql`name ASC,id ASC`;
  return {
    ids: Prisma.sql`${cte} SELECT id FROM visible ORDER BY ${finalOrder} LIMIT ${query.limit} OFFSET ${query.offset}`,
    count: Prisma.sql`${cte} SELECT count(*)::int AS total FROM visible`,
  };
}
