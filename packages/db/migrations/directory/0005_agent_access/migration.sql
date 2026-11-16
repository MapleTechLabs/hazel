CREATE TABLE IF NOT EXISTS "agent_auth_codes" (
	"codeHash" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"userId" text NOT NULL,
	"redirectUri" text NOT NULL,
	"codeChallenge" text NOT NULL,
	"scopes" text NOT NULL,
	"expiresAt" text NOT NULL,
	"redeemedAt" text,
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_clients" (
	"id" text PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	"clientName" text NOT NULL,
	"redirectUris" text NOT NULL,
	"clientUri" text,
	"logoUri" text,
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_grants" (
	"id" text PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	"userId" text NOT NULL,
	"kind" text NOT NULL,
	"clientId" text,
	"name" text NOT NULL,
	"scopes" text NOT NULL,
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	"lastUsedAt" text,
	"revokedAt" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_tokens" (
	"tokenHash" text PRIMARY KEY NOT NULL,
	"grantId" text NOT NULL,
	"kind" text NOT NULL,
	"expiresAt" text,
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_grants_user_idx" ON "agent_grants" ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tokens_grant_idx" ON "agent_tokens" ("grantId");
