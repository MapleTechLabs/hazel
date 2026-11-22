/**
 * Feature flags: the boolean flags of an account record at the source holding them (the registered
 * integration with `featureFlags`). That source is the source of truth; ingest copies them onto the
 * account (`featureFlags`) and this writes them back.
 *
 * A change goes to the source first, one request per record (an account may hold several), and each
 * account it accepted is written here from what it answered. An account it refused is left unchanged
 * and the call fails with `CustomerFeatureFlagsError`, after the others were written. The source's
 * webhook that follows brings the same set.
 */
import { featureFlagsIntegration } from "@hazel/customer-integrations"
import { Database, SQLite, schema } from "@hazel/db"
import { InternalServerError } from "@hazel/domain"
import { CustomerFeatureFlagsError, CustomersInvalidRequestError } from "@hazel/domain/rpc"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect, Option, Result } from "effect"
import { loadCredentials } from "./credentials"
import { CustomerProviders } from "./providers"
import { inList } from "./sql"

/** Stay well under what a source's API allows (100 requests per 10 s at the tightest). */
const CONCURRENCY = 4

const invalid = (message: string) => new CustomersInvalidRequestError({ message })

/** The org's connection to the flags' source, its credentials and the adapter's write. */
const flagsWriter = Effect.gen(function* () {
	const db = yield* Database.Database
	if (featureFlagsIntegration === undefined) return yield* invalid("No data source manages feature flags")
	const { id: provider, presentation } = featureFlagsIntegration
	const notConnected = `Connect ${presentation.name} to manage feature flags`
	const credentialsUnreadable = (cause: { readonly _tag: string }) =>
		Effect.fail(
			InternalServerError.withCause({
				message: `Could not read the ${presentation.name} credentials`,
				detail: cause._tag,
				cause,
			}),
		)
	const connection = yield* db.first(
		SQLite.from(schema.customerConnectionsTable)
			.select()
			.where(($) => [$.provider.eq(provider), $.status.neq("disconnected")])
			.limit(1),
	)
	if (Option.isNone(connection)) return yield* invalid(notConnected)
	// A refused key would only be refused again; a sync failing for another reason (the source down,
	// rate limited) leaves the key good, so flags stay writable.
	if (connection.value.status === "error" && connection.value.lastError?.code === "auth")
		return yield* invalid(
			`${presentation.name} rejected the secret key: update it under Data sources to manage feature flags`,
		)
	const credentials = yield* loadCredentials(connection.value).pipe(
		Effect.catchTags({
			IntegrationEncryptionError: credentialsUnreadable,
			KeyVersionNotFoundError: credentialsUnreadable,
		}),
	)
	const providers = yield* CustomerProviders
	const setFeatureFlags = Option.getOrUndefined(providers.get(provider))?.setFeatureFlags
	if (Option.isNone(credentials) || setFeatureFlags === undefined) return yield* invalid(notConnected)
	return {
		provider,
		presentation,
		connectionId: connection.value.id,
		set: (externalId: string, changes: Readonly<Record<string, boolean | null>>) =>
			setFeatureFlags(credentials.value, externalId, changes),
	}
})

/**
 * An account to write in the caller's transaction: with the source's answer, that set; without (no
 * record to ask about), the change applied to what the account holds when it is written.
 */
export interface FeatureFlagWrite {
	readonly accountId: CustomerAccountId
	readonly answered: Record<string, boolean> | null
}

/**
 * Send `changes` to the accounts' records at the source; answer what to write for each account it
 * accepted, and the error naming the ones it refused. No store write: the caller writes in its
 * transaction, which must not span the requests. With `requireRecord`, an account holding no live
 * record of the connection is refused before any request; without it (a flag being deleted) such
 * an account only has the keys removed here.
 */
export const sendFeatureFlags = Effect.fn("Customers.sendFeatureFlags")(function* (input: {
	readonly accountIds: ReadonlyArray<CustomerAccountId>
	readonly changes: Readonly<Record<string, boolean | null>>
	readonly requireRecord: boolean
}) {
	const db = yield* Database.Database
	const accountIds = [...new Set(input.accountIds)]
	const writer = yield* flagsWriter
	const refs = yield* db.run(
		SQLite.from(schema.customerExternalRefsTable)
			.select("accountId", "externalId")
			.where(($) => [
				$.entityType.eq("account"),
				$.provider.eq(writer.provider),
				$.connectionId.eq(writer.connectionId),
				$.staleAt.isNull(),
				inList($.accountId, accountIds),
			]),
	)
	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "name")
			.where(($) => [$.deletedAt.isNull(), inList($.id, accountIds)]),
	)
	const withRefs = new Set(refs.map((ref) => ref.accountId))
	if (input.requireRecord) {
		const missing = accounts.filter((account) => !withRefs.has(account.id))
		if (missing.length > 0) {
			return yield* invalid(
				`${missing.map((account) => account.name).join(", ")} ${missing.length === 1 ? "has" : "have"} no ${writer.presentation.name} ${writer.presentation.accountNoun}`,
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

	const writes: Array<FeatureFlagWrite> = accounts
		.filter((account) => !failed.has(account.id))
		.map((account) => ({ accountId: account.id, answered: answered.get(account.id) ?? null }))

	if (failed.size === 0) return { writes, error: Option.none<CustomerFeatureFlagsError>() }
	yield* Effect.logWarning(`${writer.presentation.name} refused some feature flag changes`, {
		failed: failed.size,
		reason,
	})
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

/**
 * Write each account, reading it again here: another request may have changed it while the source was
 * asked, and a change applied locally must merge into that, not into what was read before.
 */
export const writeFeatureFlags = Effect.fn("Customers.writeFeatureFlags")(function* (
	writes: ReadonlyArray<FeatureFlagWrite>,
	changes: Readonly<Record<string, boolean | null>>,
	now: Date,
) {
	const db = yield* Database.Database
	for (const { accountId, answered } of writes) {
		const current = yield* db.first(
			SQLite.from(schema.customerAccountsTable)
				.select("featureFlags")
				.where(($) => [$.id.eq(accountId)])
				.limit(1),
		)
		if (Option.isNone(current)) continue
		const held = current.value.featureFlags
		const next =
			answered ??
			Object.fromEntries(
				Object.entries({ ...held, ...changes }).filter(
					(entry): entry is [string, boolean] => entry[1] !== null,
				),
			)
		if (JSON.stringify(next) === JSON.stringify(held)) continue
		yield* db.run(
			SQLite.update(schema.customerAccountsTable)
				.set({ featureFlags: next, updatedAt: now })
				.where(($) => [$.id.eq(accountId)]),
		)
	}
})

/** Every live account holding `key` (on or off). */
export const accountsWithFlag = Effect.fn("Customers.accountsWithFlag")(function* (key: string) {
	const db = yield* Database.Database
	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "featureFlags")
			.where(($) => [$.deletedAt.isNull(), $.featureFlags.neq({})]),
	)
	return accounts.filter((account) => Object.hasOwn(account.featureFlags, key)).map((account) => account.id)
})
