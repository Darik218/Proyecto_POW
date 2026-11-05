CREATE TYPE "UserRole" AS ENUM ('ATHLETE', 'ADMIN');

ALTER TABLE "users"
  ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'ATHLETE';

ALTER TABLE "auth_sessions"
  ADD COLUMN "absolute_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0;

UPDATE "auth_sessions"
SET "absolute_expires_at" = "created_at" + INTERVAL '30 days'
WHERE "absolute_expires_at" IS NULL;

ALTER TABLE "auth_sessions"
  ALTER COLUMN "absolute_expires_at" SET NOT NULL,
  ADD CONSTRAINT "auth_sessions_absolute_lifetime_check"
    CHECK ("absolute_expires_at" > "created_at"),
  ADD CONSTRAINT "auth_sessions_generation_nonnegative_check"
    CHECK ("generation" >= 0);

CREATE TABLE "auth_session_tokens" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "generation" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumed_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "auth_session_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_session_tokens_generation_nonnegative_check" CHECK ("generation" >= 0),
  CONSTRAINT "auth_session_tokens_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "auth_session_tokens_token_hash_key"
  ON "auth_session_tokens"("token_hash");
CREATE INDEX "auth_session_tokens_session_id_generation_idx"
  ON "auth_session_tokens"("session_id", "generation");
