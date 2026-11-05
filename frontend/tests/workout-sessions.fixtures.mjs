export const id = '10000000-0000-4000-8000-000000000001'
export const exerciseId = '20000000-0000-4000-8000-000000000001'
export const operationId = '30000000-0000-4000-8000-000000000001'
export const summary = { id, status: 'IN_PROGRESS', startedAt: '2026-11-05T12:00:00.000Z', finishedAt: null, notes: null, createdAt: '2026-11-05T12:00:00.000Z', updatedAt: '2026-11-05T12:00:00.000Z', trainingPlan: null, planWeek: null, exerciseCount: 0 }
export const detail = { ...summary, exercises: [] }
export const exercise = { id: operationId, orderInSession: 1, notes: null, exercise: { id: exerciseId, name: 'Press', equipment: 'Barra', muscleGroup: 'Pectorales' }, prescription: null }
export const response = (config, data, status = 200) => ({ config, data, status, statusText: 'OK', headers: {} })
