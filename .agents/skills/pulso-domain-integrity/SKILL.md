---
name: pulso-domain-integrity
description: Preserve PULSO training planning, calendar, workout execution, and historical-data invariants during feature work or review.
---

# PULSO domain integrity

Use for changes that touch planning, scheduled activities, workout sessions, exercise targets, set records, or athlete history. Read `docs/architecture/data-model.md` and the relevant schema/module files before proposing changes.

Keep planning distinct from execution:
- Planning: `TrainingPlan → PlanWeek → PlanDay → PlanExercise`.
- Calendar programming: `ScheduledActivity`, distinct from a real workout session; trace any optional session link and its ownership/lifecycle rules.
- Execution: `WorkoutSession → WorkoutExercise → SetRecord`.
- Calendar activities may be scheduled without representing a completed or real workout session.

Keep planned targets, athlete-customized targets, and actual results distinct. Preserve historical snapshots and IDs where records must remain interpretable after plans or exercise catalog entries change. Treat known and unknown units explicitly; do not fabricate conversions. Enforce athlete ownership at every read/write boundary. Report which invariant a change affects and how it remains valid.

Check compatibility of linked entities and prevent changes to a plan or calendar entry from rewriting independent completed sessions or historical results. Keep these invariants in domain/model and application responsibilities; backend views expose the agreed public JSON. For MVC layer placement and compliance, use `pulso-architecture-review` rather than duplicating its audit here.
