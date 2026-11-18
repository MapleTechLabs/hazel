/**
 * Feature flags (`docs/customers/clerk.md`, "Feature flags"): the boolean keys of a Clerk
 * organization's `public_metadata`. Clerk is the source of truth; ingest copies them onto the
 * account (`featureFlags`) and this writes them back.
 *
 * A change goes to Clerk first, one request per organization (an account may hold several), and
 * each account Clerk accepted is written here from what Clerk answered. An account Clerk refused is
 * left unchanged and the call fails with `CustomerFeatureFlagsError`, after the others were written. Clerk's `organization.updated` webhook that follows brings the same set.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { InternalServerError } from "@hazel/domain"
import { CustomerFeatureFlagsError, CustomersInvalidRequestError } from "@hazel/domain/rpc"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect, Option, Result } from "effect"
import { loadCredentials } from "./credentials"
import { CustomerProviders } from "./providers"
import { inList } from "./sql"

/** Clerk's Backend API allows 100 requests per 10 s on a development instance: stay well under. */
const CONCURRENCY = 4

const invalid = (message: string) => new CustomersInvalidRequestError({ message })

const credentialsUnreadable = (cause: { readonly _tag: string }) =>
	Effect.fail(
		new InternalServerError({
			message: "Could not read the Clerk credentials",
			detail: cause._tag,
			cause,
		}),
	)

/** The org's Clerk connection, its credentials and the adapter's write. */
const clerkWriter = Effect.gen(function* () {
	const db = yield* Database.Database
	const connection = yield* db.first(
		SQLite.from(schema.customerConnectionsTable)
			.select()
			.where(($) => [$.provider.eq("clerk"), $.status.neq("disconnected")])
			.limit(1),
	)
	if (Option.isNone(connection)) return yield* invalid("Connect Clerk to manage feature flags")
	const credentials = yield* loadCredentials(connection.value).pipe(
		Effect.catchTags({
			IntegrationEncryptionError: credentialsUnreadable,
			KeyVersionNotFoundError: credentialsUnreadable,
		}),
	)
	const providers = yield* CustomerProviders
	const setFeatureFlags = Option.getOrUndefined(providers.get("clerk"))?.setFeatureFlags
	if (Option.isNone(credentials) || setFeatureFlags === undefined)
		return yield* invalid("Connect Clerk to manage feature flags")
	return {
		connectionId: connection.value.id,
		set: (organizationId: string, changes: Readonly<Record<string, boolean | null>>) =>
			setFeatureFlags(credentials.value, organizationId, changes),
	}
})

/** An account's new flags, to write in the caller's transaction. */
export interface FeatureFlagWrite {
	readonly accountId: CustomerAccountId
	readonly featureFlags: Record<string, boolean>
}

/**
 * Send `changes` to the accounts' Clerk organizations; answer what to write for each account Clerk
 * accepted, and the error naming the ones it refused. No store write: the caller writes in its
 * transaction, which must not span the requests. With `requireClerk`, an account holding no live
 * organization of the connection is refused before any request; without it (a flag being deleted)
 * such an account only has the keys removed here.
 */
export const sendFeatureFlags = Effect.fn("Customers.sendFeatureFlags")(function* (input: {
	readonly accountIds: ReadonlyArray<CustomerAccountId>
	readonly changes: Readonly<Record<string, boolean | null>>
	readonly requireClerk: boolean
}) {
	const db = yield* Database.Database
	const accountIds = [...new Set(input.accountIds)]
	const writer = yield* clerkWriter
	const refs = yield* db.run(
		SQLite.from(schema.customerExternalRefsTable)
			.select("accountId", "externalId")
			.where(($) => [
				$.entityType.eq("account"),
				$.provider.eq("clerk"),
				$.connectionId.eq(writer.connectionId),
				$.staleAt.isNull(),
				inList($.accountId, accountIds),
			]),
	)
	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "name", "featureFlags")
			.where(($) => [$.deletedAt.isNull(), inList($.id, accountIds)]),
	)
	const withRefs = new Set(refs.map((ref) => ref.accountId))
	if (input.requireClerk) {
		const missing = accounts.filter((account) => !withRefs.has(account.id))
		if (missing.length > 0) {
			return yield* invalid(
				`${missing.map((account) => account.name).join(", ")} ${missing.length === 1 ? "has" : "have"} no Clerk organization`,
			)
		}
	}

	const results = yield* Effect.forEach(
		refs,
		(ref) =>
			Effect.result(writer.set(ref.externalId, input.changes)).pipe(
				Effect.map((result) => ({ accountId: ref.accountId, result })),
			),
		{ concurrency: CONCURRENCY },
	)
	const failed = new Set<CustomerAccountId>()
	const answered = new Map<CustomerAccountId, Record<string, boolean>>()
	let reason = ""
	for (const { accountId, result } of results) {
		if (Result.isSuccess(result)) answered.set(accountId, result.success)
		else {
			failed.add(accountId)
			reason ||= result.failure.message
		}
	}

	const writes: Array<FeatureFlagWrite> = []
	for (const account of accounts) {
		if (failed.has(account.id)) continue
		// Clerk's answer, else (no organization to ask) the change applied to what we hold.
		const next =
			answered.get(account.id) ??
			Object.fromEntries(
				Object.entries({ ...account.featureFlags, ...input.changes }).filter(
					(entry): entry is [string, boolean] => entry[1] !== null,
				),
			)
		if (JSON.stringify(next) !== JSON.stringify(account.featureFlags))
			writes.push({ accountId: account.id, featureFlags: next })
	}

	if (failed.size === 0) return { writes, error: Option.none<CustomerFeatureFlagsError>() }
	yield* Effect.logWarning("Clerk refused some feature flag changes", { failed: failed.size, reason })
	return {
		writes,
		error: Option.some(
			new CustomerFeatureFlagsError({
				message: `${failed.size} of ${accounts.length} customers were not updated: ${reason}`,
				failedAccountIds: [...failed],
			}),
		),
	}
})

export const writeFeatureFlags = (writes: ReadonlyArray<FeatureFlagWrite>, now: Date) =>
	Effect.flatMap(Database.Database, (db) =>
		Effect.forEach(
			writes,
			({ accountId, featureFlags }) =>
				db.run(
					SQLite.update(schema.customerAccountsTable)
						.set({ featureFlags, updatedAt: now })
						.where(($) => [$.id.eq(accountId)]),
				),
			{ discard: true },
		),
	)

/** Every live account holding `key` (on or off). */
export const accountsWithFlag = Effect.fn("Customers.accountsWithFlag")(function* (key: string) {
	const db = yield* Database.Database
	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "featureFlags")
			.where(($) => [$.deletedAt.isNull(), SQLite.sql.cond`${$.featureFlags} <> '{}'`]),
	)
	return accounts.filter((account) => Object.hasOwn(account.featureFlags, key)).map((account) => account.id)
})
