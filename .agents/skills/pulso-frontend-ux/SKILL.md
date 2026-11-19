---
name: pulso-frontend-ux
description: Design or review PULSO Vue user flows for planning, daily workout logging, and mobile use while preserving the existing product design system.
---

# PULSO frontend UX

Use for PULSO user-flow or interface work. Read the affected view, its components, router entry, service/composable, and relevant styles before changing behavior. Keep the user's current design system and component patterns; use UI UX Pro Max for broader design-system choices, Impeccable for visual refinement, and Web Design Guidelines for accessibility audits rather than duplicating their general guidance here.

Prioritize Mi rutina (the athlete's routine), flexible planning, daily workout recording, mobile reachability, short forms, contextual actions, reusable Vue components, and fewer unnecessary navigation steps. Keep planned and completed activities visibly distinct. Preserve clear loading, empty, validation, and error states. Use the Vue best-practices skills for implementation details. Do not redesign unrelated screens as part of a focused task.

Check responsive layouts, keyboard/focus accessibility, and accessible form feedback within the affected flow. Respect the backend's public JSON contracts and the frontend/backend separation; backend MVC auditing belongs to `pulso-architecture-review`.

## Mandatory complementary frontend layers

Require functional `config/`, `layouts/`, `schemas/`, `types/` and `utils/` under `frontend/src/`: configuration, shared page composition, reusable validation contracts, shared types and pure helpers. Each must have real consumers and evidence of use through imports, rendering, validation, calls, type checks and focused tests. Decorative files and empty placeholders do not establish compliance.

These folders complement `components/`, `composables/`, `router/`, `services/`, `stores/`, `views/` and `assets/`; they must not substitute reusable components, reactive workflows, routing/guards, HTTP services, Pinia state, pages or assets. Do not empty functional folders, leave previously used folders without consumers, or move files solely to populate the required layers. Keep correctly encapsulated local responsibilities in place and derive types from shared Zod schemas without duplication.

For every future frontend feature, check this separation and compatibility with backend MVC, public contracts and existing behavior. Report the actual consumer and verification for each affected layer, including evidence that existing folders remain functional. Preserve authentication, calendar/history semantics, navigation and the existing visual design.
