CREATE TABLE IF NOT EXISTS "email_thread_messages" (
	"mailboxId" text NOT NULL,
	"messageId" text NOT NULL,
	"rootMessageId" text NOT NULL,
	"direction" text NOT NULL,
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	PRIMARY KEY ("mailboxId", "messageId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_threads" (
	"mailboxId" text NOT NULL,
	"rootMessageId" text NOT NULL,
	"organizationId" text NOT NULL,
	"subject" text NOT NULL,
	"participants" text NOT NULL DEFAULT '[]',
	"referenceIds" text NOT NULL DEFAULT '[]',
	"lastMessageId" text NOT NULL,
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	"updatedAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	PRIMARY KEY ("mailboxId", "rootMessageId")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_threads_organization_idx" ON "email_threads" ("organizationId");
