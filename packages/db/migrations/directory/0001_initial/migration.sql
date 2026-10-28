CREATE TABLE IF NOT EXISTS "auth_credentials" (
	"credentialId" text NOT NULL,
	"subjectId" text NOT NULL,
	"revision" text NOT NULL,
	"active" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_identifiers" (
	"moduleId" text,
	"credentialId" text,
	"namespace" text NOT NULL,
	"value" text NOT NULL,
	"subjectId" text NOT NULL,
	"revision" text NOT NULL,
	"verifiedAt" integer,
	"active" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_oauth_flows" (
	"moduleId" text NOT NULL,
	"flowId" text NOT NULL,
	"purpose" text NOT NULL,
	"generation" integer,
	"provider" text,
	"callbackId" text,
	"issuer" text,
	"responseIssuerMode" text,
	"subjectId" text,
	"stateDigest" text,
	"binderVerifier" text,
	"binderExpiresAt" integer,
	"snapshot" text,
	"issuedAt" integer,
	"expiresAt" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_oauth_identities" (
	"identityKey" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"issuer" text NOT NULL,
	"externalSubject" text NOT NULL,
	"subjectId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_oauth_logins" (
	"moduleId" text NOT NULL,
	"credentialId" text PRIMARY KEY NOT NULL,
	"subjectId" text NOT NULL,
	"identityKey" text NOT NULL,
	"credentialRevision" text NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_oauth_registrations" (
	"moduleId" text NOT NULL,
	"reference" text NOT NULL,
	"flowId" text NOT NULL,
	"identityKey" text,
	"snapshot" text,
	"expiresAt" integer,
	"retentionUntil" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_passkey_credentials" (
	"credentialId" text NOT NULL,
	"subjectId" text NOT NULL,
	"rpId" text NOT NULL,
	"protocolCredentialId" text NOT NULL,
	"credentialKey" text NOT NULL,
	"userHandle" text NOT NULL,
	"publicKey" text NOT NULL,
	"algorithm" integer NOT NULL,
	"profile" text NOT NULL,
	"credentialRevision" text NOT NULL,
	"active" integer NOT NULL,
	"primarySignIn" integer NOT NULL,
	"enrollmentUserVerified" integer NOT NULL,
	"backupEligible" integer NOT NULL,
	"backupState" integer NOT NULL,
	"counter" integer NOT NULL,
	"name" text NOT NULL,
	"createdAt" integer NOT NULL,
	"lastUsedAt" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_passkey_flows" (
	"moduleId" text NOT NULL,
	"flowId" text NOT NULL,
	"purpose" text NOT NULL,
	"snapshot" text NOT NULL,
	"requestBindingVerifier" text NOT NULL,
	"requestBindingExpiresAt" integer NOT NULL,
	"issuedAt" integer NOT NULL,
	"expiresAt" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_pending" (
	"moduleId" text NOT NULL,
	"kind" text NOT NULL,
	"digest" text NOT NULL,
	"version" text NOT NULL,
	"flowId" text NOT NULL,
	"subjectId" text NOT NULL,
	"bindingDigest" text NOT NULL,
	"snapshot" text NOT NULL,
	"expiresAt" integer NOT NULL,
	"attemptLimit" integer NOT NULL,
	"failedAttempts" integer NOT NULL,
	"consumed" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"sessionId" text NOT NULL,
	"subjectId" text NOT NULL,
	"digest" text NOT NULL,
	"securityRevision" text NOT NULL,
	"issuedAt" integer NOT NULL,
	"expiresAt" integer NOT NULL,
	"absoluteExpiresAt" integer NOT NULL,
	"record" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bot_commands" (
	"id" text PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	"botId" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"arguments" text DEFAULT '[]',
	"usageExample" text,
	"isEnabled" integer NOT NULL DEFAULT true,
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	"updatedAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bots" (
	"id" text PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	"userId" text NOT NULL,
	"createdBy" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"webhookUrl" text,
	"apiTokenHash" text NOT NULL,
	"scopes" text,
	"metadata" text,
	"isPublic" integer NOT NULL DEFAULT false,
	"installCount" integer NOT NULL DEFAULT 0,
	"mentionable" integer NOT NULL DEFAULT false,
	"allowedIntegrations" text DEFAULT '[]',
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	"updatedAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	"deletedAt" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_index" (
	"channelId" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"hostChannelId" text,
	"deletedAt" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_sync_index" (
	"id" text PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	"provider" text NOT NULL,
	"externalWorkspaceId" text NOT NULL,
	"externalChannelId" text,
	"organizationId" text NOT NULL,
	"channelId" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connect_invites" (
	"id" text PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	"conversationId" text NOT NULL,
	"hostOrganizationId" text NOT NULL,
	"hostChannelId" text NOT NULL,
	"targetKind" text NOT NULL,
	"targetValue" text NOT NULL,
	"guestOrganizationId" text,
	"status" text NOT NULL DEFAULT 'pending',
	"allowGuestMemberAdds" integer NOT NULL DEFAULT false,
	"invitedBy" text NOT NULL,
	"acceptedBy" text,
	"acceptedAt" text,
	"expiresAt" text,
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	"updatedAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	"deletedAt" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_index" (
	"provider" text NOT NULL,
	"externalId" text NOT NULL,
	"organizationId" text NOT NULL,
	PRIMARY KEY ("provider", "externalId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "membership_index" (
	"userId" text NOT NULL,
	"organizationId" text NOT NULL,
	"deletedAt" text,
	PRIMARY KEY ("userId", "organizationId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_index" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text,
	"name" text NOT NULL,
	"deletedAt" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_invitations" (
	"id" text PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	"organizationId" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL DEFAULT 'member',
	"tokenHash" text NOT NULL,
	"invitedBy" text NOT NULL,
	"status" text NOT NULL DEFAULT 'pending',
	"expiresAt" text NOT NULL,
	"acceptedBy" text,
	"acceptedAt" text,
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	"updatedAt" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
	"externalId" text NOT NULL,
	"authActive" integer NOT NULL DEFAULT true,
	"securityRevision" text NOT NULL DEFAULT 'initial',
	"email" text NOT NULL,
	"firstName" text NOT NULL,
	"lastName" text NOT NULL,
	"avatarUrl" text,
	"userType" text NOT NULL DEFAULT 'user',
	"settings" text,
	"isOnboarded" integer NOT NULL DEFAULT false,
	"timezone" text,
	"createdAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	"updatedAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	"deletedAt" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_index" (
	"webhookId" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"channelId" text NOT NULL,
	"tokenHash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "yielded_browser_login" (
	"namespace" text NOT NULL,
	"attempt_id" text NOT NULL,
	"version" text NOT NULL,
	"expires_at_millis" integer NOT NULL,
	"payload" text NOT NULL,
	PRIMARY KEY ("namespace", "attempt_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_credentials_credentialId_unique" ON "auth_credentials" ("credentialId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_credentials_subject_credential" ON "auth_credentials" ("subjectId", "credentialId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_identifiers_namespace_value" ON "auth_identifiers" ("namespace", "value");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_oauth_flows_module_flow" ON "auth_oauth_flows" ("moduleId", "flowId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_oauth_flows_stateDigest_unique" ON "auth_oauth_flows" ("stateDigest");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_oauth_identities_subject_idx" ON "auth_oauth_identities" ("subjectId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_oauth_logins_identityKey_unique" ON "auth_oauth_logins" ("identityKey");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_oauth_logins_owner_idx" ON "auth_oauth_logins" ("identityKey", "subjectId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_oauth_registrations_module_flow" ON "auth_oauth_registrations" ("moduleId", "flowId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_oauth_registrations_module_reference" ON "auth_oauth_registrations" ("moduleId", "reference");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_passkey_credentials_credentialId_unique" ON "auth_passkey_credentials" ("credentialId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_passkey_credentials_credentialKey_unique" ON "auth_passkey_credentials" ("credentialKey");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_passkey_credentials_subject_idx" ON "auth_passkey_credentials" ("subjectId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_passkey_flows_module_flow" ON "auth_passkey_flows" ("moduleId", "flowId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_pending_digest_unique" ON "auth_pending" ("digest");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_digest_unique" ON "auth_sessions" ("digest");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_sessionId_unique" ON "auth_sessions" ("sessionId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_subject_idx" ON "auth_sessions" ("subjectId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_commands_bot_id_idx" ON "bot_commands" ("botId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bot_commands_bot_id_name_idx" ON "bot_commands" ("botId", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bots_created_by_idx" ON "bots" ("createdBy");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bots_deleted_at_idx" ON "bots" ("deletedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bots_is_public_idx" ON "bots" ("isPublic");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bots_userId_unique" ON "bots" ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bots_user_id_idx" ON "bots" ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_index_host_channel_id_idx" ON "channel_index" ("hostChannelId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_index_organization_id_idx" ON "channel_index" ("organizationId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_sync_index_external_unique" ON "chat_sync_index" ("provider", "externalWorkspaceId", "externalChannelId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_sync_index_organization_id_idx" ON "chat_sync_index" ("organizationId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connect_invites_conversation_idx" ON "connect_invites" ("conversationId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connect_invites_deleted_at_idx" ON "connect_invites" ("deletedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connect_invites_guest_org_idx" ON "connect_invites" ("guestOrganizationId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connect_invites_host_org_idx" ON "connect_invites" ("hostOrganizationId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connect_invites_status_idx" ON "connect_invites" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connect_invites_target_idx" ON "connect_invites" ("targetKind", "targetValue");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_index_organization_id_idx" ON "integration_index" ("organizationId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "membership_index_organization_id_idx" ON "membership_index" ("organizationId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_index_slug_idx" ON "org_index" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_invitations_organization_id_idx" ON "organization_invitations" ("organizationId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_invitations_token_hash_idx" ON "organization_invitations" ("tokenHash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_deleted_at_idx" ON "users" ("deletedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_externalId_unique" ON "users" ("externalId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_external_id_idx" ON "users" ("externalId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_user_type_idx" ON "users" ("userType");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_index_token_hash_unique" ON "webhook_index" ("tokenHash");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_invitations_pending_email_idx" ON "organization_invitations" ("organizationId", "email") WHERE "status" = 'pending';
