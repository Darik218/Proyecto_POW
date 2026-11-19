---
name: pulso-integration-testing
description: Select safe, focused PULSO unit, HTTP integration, PostgreSQL isolation, frontend, type-check, and build commands for a proposed change.
---

# PULSO integration testing

Use when choosing or running verification for a PULSO code change. First inspect the actual scripts in `backend/package.json`, `frontend/package.json`, and relevant test helpers; do not assume a command is safe from its name alone.

Select the narrowest checks that cover the changed behavior: focused unit tests, HTTP integration tests, isolated PostgreSQL runners, frontend interaction tests, TypeScript checks, or builds. Inspect runner configuration and environment loading before executing tests that may write to a database. Do not run a test suite against `proyecto_pow_dev`; use only a temporary isolated database for PostgreSQL integration. Summarize commands and results without claiming checks that were not run.

For changes affecting backend MVC, take compliance criteria from `pulso-architecture-review` and select relevant checks for:
- Controller registration in the owning NestJS module and successful dependency resolution.
- Controller → application service → domain/model → repository interactions, with persistence delegated to repositories.
- Calls to the corresponding backend JSON view and response serialization, including sensitive-field exclusion.
- HTTP status, authentication/authorization, and frontend/API response-contract compatibility.

Inspect current scripts before using `backend` commands `test` or `test:e2e`, `frontend` command `test`, or the isolated runners `backend/test/run-routine-isolated.mjs` and `backend/test/run-workouts-r2-isolated.mjs`. Their presence is not authorization to execute them against an arbitrary database. Check actual TypeScript/build scripts when requested. MVC evidence requires meaningful behavior checks, not only matching folder names; a scoped change does not require every suite.
