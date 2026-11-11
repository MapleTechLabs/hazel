CREATE TABLE IF NOT EXISTS "chat_sync_installations" (
	"provider" text NOT NULL,
	"externalWorkspaceId" text NOT NULL,
	"externalWorkspaceName" text,
	"encryptedToken" text NOT NULL,
	"iv" text NOT NULL,
	"encryptionKeyVersion" integer NOT NULL,
	"scope" text,
	"installedBy" text,
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	"updatedAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	PRIMARY KEY ("provider", "externalWorkspaceId")
);
