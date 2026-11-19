---
name: pulso-prisma-migrations
description: Plan or review PULSO Prisma schema and migration changes, including data preservation and isolated PostgreSQL verification.
---

# PULSO Prisma migrations

Use when editing or reviewing `backend/prisma/schema.prisma`, migration SQL, or Prisma persistence behavior. Keep migrations additive where feasible; inspect existing migration history and data relationships before proposing constraints or renames. Preserve historical IDs and records, validate foreign keys, nullability, uniqueness, defaults, and rollback implications. Avoid destructive resets.

Identify the configured database target before any database command. Use a temporary isolated PostgreSQL database for migration verification when available, and keep seed data separate. Never apply a migration to `proyecto_pow_dev`, run seeds there, or reset any database without explicit authorization. Report exact commands and any unverified assumptions.

Check schema consistency and the actual Prisma configuration before choosing validation/generation commands. Preserve historical foreign-key references as well as IDs. Never use a development-database reset to verify a migration. Persistence changes must respect PULSO's mandatory MVC boundaries: Prisma persistence types do not automatically replace domain models, and business logic must not be moved into Prisma queries or HTTP controllers as a substitute for MVC. Use `pulso-architecture-review` when layer placement is affected.
