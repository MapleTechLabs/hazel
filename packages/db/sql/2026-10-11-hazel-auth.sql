-- Hazel sign-in (@hazel/auth/server): the auth_* tables and two users columns.
--
-- Additive only, in one transaction; safe to apply while the app runs. Generated from the
-- Drizzle schema (packages/db/src/schema/auth.ts, users.ts) via pg_dump of a pushed
-- database, because `drizzle-kit push` against prd would also act on unrelated drift.
-- Both column defaults are constants, so adding them does not rewrite users.
--
-- Apply: psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/sql/2026-10-11-hazel-auth.sql

BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "authActive" boolean NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "securityRevision" text NOT NULL DEFAULT 'initial';


CREATE TABLE public.auth_credentials (
    "credentialId" text NOT NULL,
    "subjectId" uuid NOT NULL,
    revision text NOT NULL,
    active boolean NOT NULL
);

CREATE TABLE public.auth_identifiers (
    "moduleId" text,
    "credentialId" text,
    namespace text NOT NULL,
    value text NOT NULL,
    "subjectId" uuid NOT NULL,
    revision text NOT NULL,
    "verifiedAt" bigint,
    active boolean NOT NULL
);

CREATE TABLE public.auth_oauth_flows (
    "moduleId" text NOT NULL,
    "flowId" text NOT NULL,
    purpose text NOT NULL,
    generation bigint,
    provider text,
    "callbackId" text,
    issuer text,
    "responseIssuerMode" text,
    "subjectId" uuid,
    "stateDigest" text,
    "binderVerifier" text,
    "binderExpiresAt" bigint,
    snapshot text,
    "issuedAt" bigint,
    "expiresAt" bigint
);

CREATE TABLE public.auth_oauth_identities (
    "identityKey" text NOT NULL,
    provider text NOT NULL,
    issuer text NOT NULL,
    "externalSubject" text NOT NULL,
    "subjectId" uuid NOT NULL
);

CREATE TABLE public.auth_oauth_logins (
    "moduleId" text NOT NULL,
    "credentialId" text NOT NULL,
    "subjectId" uuid NOT NULL,
    "identityKey" text NOT NULL,
    "credentialRevision" text NOT NULL,
    status text NOT NULL
);

CREATE TABLE public.auth_oauth_registrations (
    "moduleId" text NOT NULL,
    reference text NOT NULL,
    "flowId" text NOT NULL,
    "identityKey" text,
    snapshot text,
    "expiresAt" bigint,
    "retentionUntil" bigint
);

CREATE TABLE public.auth_passkey_credentials (
    "credentialId" text NOT NULL,
    "subjectId" uuid NOT NULL,
    "rpId" text NOT NULL,
    "protocolCredentialId" text NOT NULL,
    "credentialKey" text NOT NULL,
    "userHandle" text NOT NULL,
    "publicKey" text NOT NULL,
    algorithm bigint NOT NULL,
    profile text NOT NULL,
    "credentialRevision" text NOT NULL,
    active boolean NOT NULL,
    "primarySignIn" boolean NOT NULL,
    "enrollmentUserVerified" boolean NOT NULL,
    "backupEligible" boolean NOT NULL,
    "backupState" boolean NOT NULL,
    counter bigint NOT NULL,
    name text NOT NULL,
    "createdAt" bigint NOT NULL,
    "lastUsedAt" bigint
);

CREATE TABLE public.auth_passkey_flows (
    "moduleId" text NOT NULL,
    "flowId" text NOT NULL,
    purpose text NOT NULL,
    snapshot text NOT NULL,
    "requestBindingVerifier" text NOT NULL,
    "requestBindingExpiresAt" bigint NOT NULL,
    "issuedAt" bigint NOT NULL,
    "expiresAt" bigint NOT NULL
);

CREATE TABLE public.auth_pending (
    "moduleId" text NOT NULL,
    kind text NOT NULL,
    digest text NOT NULL,
    version text NOT NULL,
    "flowId" text NOT NULL,
    "subjectId" uuid NOT NULL,
    "bindingDigest" text NOT NULL,
    snapshot text NOT NULL,
    "expiresAt" bigint NOT NULL,
    "attemptLimit" bigint NOT NULL,
    "failedAttempts" bigint NOT NULL,
    consumed boolean NOT NULL
);

CREATE TABLE public.auth_sessions (
    "sessionId" text NOT NULL,
    "subjectId" uuid NOT NULL,
    digest text NOT NULL,
    "securityRevision" text NOT NULL,
    "issuedAt" bigint NOT NULL,
    "expiresAt" bigint NOT NULL,
    "absoluteExpiresAt" bigint NOT NULL,
    record text NOT NULL
);

ALTER TABLE ONLY public.auth_credentials
    ADD CONSTRAINT "auth_credentials_credentialId_unique" UNIQUE ("credentialId");

ALTER TABLE ONLY public.auth_credentials
    ADD CONSTRAINT auth_credentials_subject_credential UNIQUE ("subjectId", "credentialId");

ALTER TABLE ONLY public.auth_identifiers
    ADD CONSTRAINT auth_identifiers_namespace_value UNIQUE (namespace, value);

ALTER TABLE ONLY public.auth_oauth_flows
    ADD CONSTRAINT auth_oauth_flows_module_flow UNIQUE ("moduleId", "flowId");

ALTER TABLE ONLY public.auth_oauth_flows
    ADD CONSTRAINT "auth_oauth_flows_stateDigest_unique" UNIQUE ("stateDigest");

ALTER TABLE ONLY public.auth_oauth_identities
    ADD CONSTRAINT auth_oauth_identities_pkey PRIMARY KEY ("identityKey");

ALTER TABLE ONLY public.auth_oauth_logins
    ADD CONSTRAINT "auth_oauth_logins_identityKey_unique" UNIQUE ("identityKey");

ALTER TABLE ONLY public.auth_oauth_logins
    ADD CONSTRAINT auth_oauth_logins_pkey PRIMARY KEY ("credentialId");

ALTER TABLE ONLY public.auth_oauth_registrations
    ADD CONSTRAINT auth_oauth_registrations_module_flow UNIQUE ("moduleId", "flowId");

ALTER TABLE ONLY public.auth_oauth_registrations
    ADD CONSTRAINT auth_oauth_registrations_module_reference UNIQUE ("moduleId", reference);

ALTER TABLE ONLY public.auth_passkey_credentials
    ADD CONSTRAINT "auth_passkey_credentials_credentialId_unique" UNIQUE ("credentialId");

ALTER TABLE ONLY public.auth_passkey_credentials
    ADD CONSTRAINT "auth_passkey_credentials_credentialKey_unique" UNIQUE ("credentialKey");

ALTER TABLE ONLY public.auth_passkey_flows
    ADD CONSTRAINT auth_passkey_flows_module_flow UNIQUE ("moduleId", "flowId");

ALTER TABLE ONLY public.auth_pending
    ADD CONSTRAINT auth_pending_digest_unique UNIQUE (digest);

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_digest_unique UNIQUE (digest);

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT "auth_sessions_sessionId_unique" UNIQUE ("sessionId");

CREATE INDEX auth_oauth_identities_subject_idx ON public.auth_oauth_identities USING btree ("subjectId");

CREATE INDEX auth_oauth_logins_owner_idx ON public.auth_oauth_logins USING btree ("identityKey", "subjectId");

CREATE INDEX auth_passkey_credentials_subject_idx ON public.auth_passkey_credentials USING btree ("subjectId");

CREATE INDEX auth_sessions_subject_idx ON public.auth_sessions USING btree ("subjectId");


COMMIT;
