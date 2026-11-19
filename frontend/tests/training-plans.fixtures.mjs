export const planId = '10000000-0000-4000-8000-000000000001'
export const weekId = '20000000-0000-4000-8000-000000000001'
export const exerciseId = '30000000-0000-4000-8000-000000000001'
export const prescriptionId = '40000000-0000-4000-8000-000000000001'
export const plan = { id: planId, name: 'Fuerza base', startsOn: '2026-11-01T00:00:00.000Z', endsOn: null, status: 'DRAFT', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' }
export const week = { id: weekId, weekNumber: 1, objective: null }
export const prescription = { id: prescriptionId, position: 1, targetSets: 3, targetReps: 8, targetRpe: 7.5, targetLoad: 42.125, notes: null, exercise: { id: exerciseId, name: 'Press de banca', muscleGroup: 'Pectorales', equipment: 'Barra', description: null } }
export const detail = { ...plan, weeks: [{ ...week, exercises: [prescription] }] }
export const response = (config, data, status = 200) => ({ config, data, status, statusText: 'OK', headers: {} })

export const dayId = '50000000-0000-4000-8000-000000000001'
export const dailyPrescription = { ...prescription, targetRepsMin: 8, targetRepsMax: 8, targetLoadUnit: null, hasHistory: false }
export const day = { id: dayId, name: 'Superior A', position: 1, weekday: null, hasHistory: false, exercises: [dailyPrescription] }
export const planning = { ...plan, weeks: [{ ...week, days: [day], pendingExercises: [] }] }
