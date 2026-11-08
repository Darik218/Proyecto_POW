import { jest } from '@jest/globals';
import { sqltag, join, raw, empty } from '@prisma/client/runtime/client';
jest.unstable_mockModule('../generated/prisma/client', () => ({
  Prisma: { sql: sqltag, join, raw, empty },
}));
import type {exerciseSearchQuery as QueryBuilder} from './exercise-search.query';
let exerciseSearchQuery:typeof QueryBuilder;
beforeAll(async()=>{const path='./exercise-search.query';exerciseSearchQuery=(await import(path) as {exerciseSearchQuery:typeof QueryBuilder}).exerciseSearchQuery;});
describe('Exercise search SQL construction', () => {
  it('binds every user input instead of interpolating it into SQL text', () => {
    const search = "'; DROP TABLE exercises; --";
    const query = exerciseSearchQuery(
      {
        search,
        limit: 20,
        offset: 0,
        equipmentType: 'DUMBBELL',
        primaryMuscleGroupKey: 'biceps',
      },
      'VISIBLE',
      '10000000-0000-4000-8000-000000000001',
    );
    expect(query.ids.text).not.toContain(search);
    expect(query.ids.values).toContain(search);
    expect(query.ids.text).toContain('owner_id=');
    expect(query.ids.values).toContain('DUMBBELL');
    expect(query.ids.values).toContain('biceps');
  });
  it('bounds fuzzy matching to queries of at least three normalized characters and includes deterministic ranking', () => {
    const query = exerciseSearchQuery(
      { search: 'rd', limit: 5, offset: 5 },
      'GLOBAL',
    );
    expect(query.ids.text).toContain('length(q.term)>=3');
    expect(query.ids.text).toContain(
      'ORDER BY rank ASC,score DESC,name ASC,id ASC',
    );
    expect(query.ids.values).toContain(5);
  });
});
