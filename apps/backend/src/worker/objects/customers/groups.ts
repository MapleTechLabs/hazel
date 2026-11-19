/**
 * Customers with several environments (`customers.account.link`, `unlink`, `setPrimary`,
 * `setEnvironment`). Accounts are never merged: each Clerk organization stays its own account (an
 * environment, e.g. a US and an EU region), and accounts link into a group with one primary
 * (`primaryAccountId` on the others; no chains). Rollups and health stay per account; signals are
 * evaluated over the group's combined facts (`./group-facts.ts`) and are only ever written on the
 * primary, so its other environments hold no unclosed signal.
 *
 * Each runs inside the caller's transaction, records a `hazel` event on the accounts it changes and
 * asks for a compute.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { CustomerGroupError } from "@hazel/domain/rpc"
import type { CustomerAccountId, UserId } from "@hazel/schema"
import { Effect } from "effect"
import { requestCompute } from "./schedule"

const ZERO_COUNTERS = { openRiskHigh: 0, openRiskMedium: 0, openRiskLow: 0, openOpportunities: 0 }

const recordEvent = (
	accountId: CustomerAccountId,
	type: string,
	title: string,
	data: Record<string, unknown>,
	actor: UserId,
	now: Date,
) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.insertInto(schema.customerEventsTable).values({
				accountId,
				provider: "hazel",
				type,
				title,
				data,
				occurredAt: now,
				actorUserId: actor,
			}),
		),
	)

/**
 * `source` and the environments it is primary of join `primary`'s group (both live, checked by the
 * caller). Their unclosed signals close, the group's being the primary's from now on: open or
 * snoozed ones auto-resolve, done or dismissed ones (waiting to reopen) close as they are.
 */
export const linkAccounts = Effect.fn("Customers.linkAccounts")(function* (
	source: schema.CustomerAccount,
	primary: schema.CustomerAccount,
	actor: UserId,
	now: Date,
) {
	if (source.id === primary.id)
		return yield* new CustomerGroupError({
			reason: "same_account",
			message: "An account cannot be linked to itself",
		})
	if (primary.primaryAccountId !== null)
		return yield* new CustomerGroupError({
			reason: "primary_is_environment",
			message: `${primary.name} is an environment of another customer: link to its primary`,
		})
	const db = yield* Database.Database
	const moved = yield* db.run(
		SQLite.update(schema.customerAccountsTable)
			.set({ primaryAccountId: primary.id, ...ZERO_COUNTERS, updatedAt: now })
			.where(($) => [SQLite.or($.id.eq(source.id), $.primaryAccountId.eq(source.id))])
			.returning("id", "name"),
	)
	const ids = moved.map((account) => account.id)
	yield* db.run(
		SQLite.update(schema.customerSignalsTable)
			.set({ status: "auto_resolved", resolvedAt: now, closedAt: now, updatedAt: now })
			.where(($) => [$.accountId.in_(...ids), $.closedAt.isNull(), $.status.in_("open", "snoozed")]),
	)
	yield* db.run(
		SQLite.update(schema.customerSignalsTable)
			.set({ closedAt: now, updatedAt: now })
			.where(($) => [$.accountId.in_(...ids), $.closedAt.isNull()]),
	)
	for (const account of moved)
		yield* recordEvent(
			account.id,
			"account.linked",
			`Linked to ${primary.name}`,
			{ primaryAccountId: primary.id, name: primary.name },
			actor,
			now,
		)
	yield* recordEvent(
		primary.id,
		"account.linked",
		`Linked ${moved.map((account) => account.name).join(", ")}`,
		{ accountIds: ids },
		actor,
		now,
	)
	yield* Effect.annotateCurrentSpan({ "customers.linked_accounts": ids.length })
	yield* requestCompute
})

/**
 * A non-primary environment stands alone again. A primary with live environments is refused; a
 * standalone account is left as it is.
 */
export const unlinkAccount = Effect.fn("Customers.unlinkAccount")(function* (
	account: schema.CustomerAccount,
	actor: UserId,
	now: Date,
) {
	const db = yield* Database.Database
	const primaryId = account.primaryAccountId
	if (primaryId === null) {
		const [environment] = yield* db.run(
			SQLite.from(schema.customerAccountsTable)
				.select("id")
				.where(($) => [$.primaryAccountId.eq(account.id), $.deletedAt.isNull()])
				.limit(1),
		)
		if (environment === undefined) return
		return yield* new CustomerGroupError({
			reason: "primary_has_environments",
			message: `${account.name} is the primary of its customer: make another environment primary first`,
		})
	}
	yield* db.run(
		SQLite.update(schema.customerAccountsTable)
			.set({ primaryAccountId: null, updatedAt: now })
			.where(($) => [$.id.eq(account.id)]),
	)
	yield* recordEvent(
		account.id,
		"account.unlinked",
		"Unlinked",
		{ primaryAccountId: primaryId },
		actor,
		now,
	)
	yield* recordEvent(
		primaryId,
		"account.unlinked",
		`Unlinked ${account.name}`,
		{ accountId: account.id, name: account.name },
		actor,
		now,
	)
	yield* requestCompute
})

/**
 * `account` becomes the primary of its group: the old primary and the other environments point at
 * it, and the group's unclosed signals (and their counters) move from the old primary to it. A
 * primary or standalone account is left as it is.
 */
export const setPrimaryAccount = Effect.fn("Customers.setPrimaryAccount")(function* (
	account: schema.CustomerAccount,
	actor: UserId,
	now: Date,
) {
	const oldId = account.primaryAccountId
	if (oldId === null) return
	const db = yield* Database.Database
	const [counters] = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("openRiskHigh", "openRiskMedium", "openRiskLow", "openOpportunities")
			.where(($) => [$.id.eq(oldId)]),
	)
	yield* db.run(
		SQLite.update(schema.customerAccountsTable)
			.set({ primaryAccountId: account.id, ...ZERO_COUNTERS, updatedAt: now })
			.where(($) => [$.id.eq(oldId)]),
	)
	yield* db.run(
		SQLite.update(schema.customerAccountsTable)
			.set({ primaryAccountId: account.id, updatedAt: now })
			.where(($) => [$.primaryAccountId.eq(oldId), $.id.neq(account.id)]),
	)
	// An environment holds no unclosed signal: one episode per rule and account still holds.
	yield* db.run(
		SQLite.update(schema.customerSignalsTable)
			.set({ accountId: account.id, updatedAt: now })
			.where(($) => [$.accountId.eq(oldId), $.closedAt.isNull()]),
	)
	yield* db.run(
		SQLite.update(schema.customerAccountsTable)
			.set({ primaryAccountId: null, ...counters, updatedAt: now })
			.where(($) => [$.id.eq(account.id)]),
	)
	yield* recordEvent(
		account.id,
		"account.primary_changed",
		"Made primary",
		{ fromAccountId: oldId },
		actor,
		now,
	)
	yield* recordEvent(
		oldId,
		"account.primary_changed",
		`${account.name} made primary`,
		{ toAccountId: account.id, name: account.name },
		actor,
		now,
	)
	yield* requestCompute
})

/** Name the account's environment; blank or null clears it. */
export const setEnvironment = Effect.fn("Customers.setEnvironment")(function* (
	account: schema.CustomerAccount,
	environment: string | null,
	actor: UserId,
	now: Date,
) {
	const db = yield* Database.Database
	const name = environment?.trim() || null
	if (name === account.environment) return
	yield* db.run(
		SQLite.update(schema.customerAccountsTable)
			.set({ environment: name, updatedAt: now })
			.where(($) => [$.id.eq(account.id)]),
	)
	yield* recordEvent(
		account.id,
		"account.environment_changed",
		name === null ? "Environment cleared" : `Environment: ${name}`,
		{ from: account.environment, to: name },
		actor,
		now,
	)
})
