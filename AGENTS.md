# PULSO skills

Use project skills selectively from `.agents/skills/`; load only those relevant to the task.

- `pulso-architecture-review`: mandatory backend MVC compliance, NestJS boundaries, API contracts, integrity, and change impact reviews.
- `pulso-prisma-migrations`: Prisma schema/migration planning and isolated PostgreSQL verification.
- `pulso-domain-integrity`: planning, scheduled activity, workout execution, and history invariants.
- `pulso-integration-testing`: safe, focused checks chosen from the repository's real scripts.
- `pulso-frontend-ux`: PULSO-specific Vue flows and mobile experience.
- `graphify`: on-demand dependency and relationship exploration; do not index or update automatically.

For interface work, use UI UX Pro Max for visual design decisions, Design System for consistency of existing components/tokens, Impeccable for visual refinement, Web Design Guidelines for accessibility, and the Vue skills for implementation, debugging, routing, state, or testing as relevant. Superpowers supplies development methodology; Codex Security supplies security review when installed and invoked. Do not load every skill for routine tasks.

Preserve existing changes. Do not change branches, create worktrees, commit, or push without explicit authorization. Do not apply Prisma migrations, seed, or reset `proyecto_pow_dev` without explicit authorization. Use isolated databases for integration checks.

## Mandatory MVC Architecture

The PULSO backend MUST explicitly implement Model–View–Controller (MVC):

- `backend/src/models/`: domain entities and structures, distinct from input DTOs, public response representations, and Prisma persistence types. Reuse Prisma types where appropriate without duplicating them mechanically; models must not contain HTTP or persistence operations.
- `backend/src/views/`: reusable presenters, serializers, or transformers that prepare public JSON responses and exclude sensitive internal fields. Vue 3 renders the separate frontend; it does not replace this backend layer. An HTML template engine is not required.
- `backend/src/controllers/`: functional NestJS HTTP controllers, registered in modules, using decorators, dependency injection, validation, authentication, and authorization. Delegate use cases to services; keep Prisma queries and complex business logic outside controllers.

Complementary `backend/src/services/`, `backend/src/repositories/`, and `backend/src/domain/` layers provide application coordination, persistence, and policies/calculations respectively. They complement the three required MVC layers and must coexist with NestJS modules and dependency injection.

Prisma models, module-local `*.controller.ts` files, and empty directories do not establish compliance with the agreed structure. Verify actual imports, module registrations, HTTP execution paths, JSON transformations, and focused tests. Do not create empty folders or duplicate implementations to claim compliance.

Use `pulso-architecture-review` and its `references/mvc-architecture.md` for backend architecture changes and MVC checks. Classify each layer as **No implementado**, **Parcial**, **Implementado**, or **Verificado**; declare global MVC compliance only when all three required layers are implemented and verified. This classification is separate from functional E0–E5 status. Distinguish current evidence from pending implementation or verification.

Every future backend feature must receive a scoped MVC compatibility check, including controllers, models, JSON responses, services, repositories, 1RM estimates, progression algorithms, recommendations, and statistics. Preserve endpoints, authorization, JSON contracts, athlete ownership, database integrity, and historical IDs/data. Review authorization does not authorize refactoring.

This project-specific MVC requirement takes precedence over incompatible generic architecture recommendations from skills or plugins, including Superpowers and generic NestJS guidance. If NestJS organization conflicts with the required layers, document the conflict and propose a compliant alternative without unnecessary duplication; obtain authorization before applying a procedure incompatible with project constraints.

## Verification and tool boundaries

Work on the current `feature` branch unless a branch change is explicitly authorized. Keep existing Git and PostgreSQL restrictions above. Never use a development database reset as a verification step. Select focused checks from the actual scripts and inspect database-writing runners before execution; retain authorization, privacy, and frontend/backend compatibility checks.

Graphify remains on demand, without automatic indexing or rebuilds. Impeccable hooks remain disabled. Enable automatic hooks only with explicit approval. Skills do not authorize unrelated application edits, dependency upgrades, or changes to the user's default Codex model/reasoning settings.

## Mandatory complementary frontend architecture

`frontend/src/config/`, `layouts/`, `schemas/`, `types/` and `utils/` are mandatory functional layers: reusable configuration, page layouts, shared validation contracts, shared TypeScript types, and pure helpers respectively. Each must have real consumers; demonstrate its use through application imports, rendering, validation, calls, type checks and focused tests. Files or folders created only to appear compliant do not satisfy the rubric.

These layers complement the existing `components/`, `composables/`, `router/`, `services/`, `stores/`, `views/` and `assets/`. Preserve reusable UI, reactive logic, navigation/guards, HTTP operations, Pinia state, pages and assets in their existing responsibilities. Do not replace these layers, empty functional folders, or abandon their consumers to manufacture compliance. Keep local contracts/types/helpers local when sharing is unnecessary; infer shared types from Zod schemas where appropriate rather than duplicating them.

Future frontend features must respect this separation, retain compatibility with backend MVC and public HTTP contracts, and provide evidence that both complementary and existing layers remain functional. Preserve authentication, ownership, calendar associations, historical semantics, routes and visual behavior during structural changes.
