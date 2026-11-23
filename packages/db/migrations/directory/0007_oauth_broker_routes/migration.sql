CREATE TABLE IF NOT EXISTS "oauth_broker_routes" (
	"provider" text NOT NULL,
	"externalId" text NOT NULL,
	"instanceId" text NOT NULL,
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	PRIMARY KEY ("provider", "externalId")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_broker_routes_instance_id_idx" ON "oauth_broker_routes" ("instanceId");
