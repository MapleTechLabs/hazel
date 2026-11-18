CREATE TABLE IF NOT EXISTS "push_device_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_device_tokens_user_id_idx" ON "push_device_tokens" ("userId");
