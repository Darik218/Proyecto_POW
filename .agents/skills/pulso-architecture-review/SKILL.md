---
name: pulso-architecture-review
description: Evaluate mandatory PULSO backend MVC (models, JSON views, controllers), NestJS modules, responsibility boundaries, dependencies, integrity, and frontend/API contracts for backend features or architectural changes.
---

# PULSO architecture review

Use this for backend feature compatibility, architecture, or change-impact review. Read the root `AGENTS.md`; PULSO's explicit MVC requirement takes priority over incompatible generic architecture guidance.

For backend work, load [references/mvc-architecture.md](references/mvc-architecture.md). Check real models, public JSON views, controllers, and the complete relevant HTTP path using file/function/import/module-registration evidence. Empty folders, Prisma types alone, or module-local NestJS controllers alone cannot establish compliance. Classify each required layer and distinguish pending work from verified behavior; MVC status is independent of E0–E5.

Start from touched modules and direct callers. Use Graphify only when complex cross-module relationships materially help; do not index or rebuild automatically. Keep the report concise and separate confirmed findings from risks.

Review NestJS module responsibilities, repository/service/controller boundaries, API contracts, frontend service/composable consumers, and Prisma access. Check for duplicated behavior, dependency cycles, authorization and athlete ownership boundaries, and backwards compatibility. Trace relevant OpenAPI or project docs when contracts change. Do not broaden into a full security or UX audit unless requested.

Preserve existing user changes. Do not change branches, create worktrees, commit, or push without explicit authorization. Never apply database changes as part of a review. An audit prepares evidence and recommendations; obtain separate authorization for application refactoring.
