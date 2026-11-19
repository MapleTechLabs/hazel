/**
 * The Customers area's optimistic actions: each applies the change to the synced collections at
 * once, runs the `customers.*` RPC, awaits its `customers:<org>` transactionId, and rolls back on
 * failure (`src/core/db/actions.ts` has the pattern). Run them from a Command and settle with
 * `Effect.catchTags` for the RPC's own errors, then `catchCommon` (`docs/foldkit-decisions/s6-errors.md`).
 *
 * An RPC's optional fields are left out of its payload when not given: the schema takes an
 * optional key as absent, never as `undefined`.
 */
import type * as Customers from "@hazel/domain/customers"
import {
	type CustomerAccountId,
	CustomerFeatureFlagId,
	CustomerImpersonatorId,
	CustomerNoteId,
	type CustomerSignalId,
	type OrganizationId,
	type UserId,
} from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { Clock, Effect } from "effect"
import {
	customerAccountCollection,
	customerFeatureFlagCollection,
	customerImpersonatorCollection,
	customerNoteCollection,
	customerSignalCollection,
} from "~/db/collections"
import { HazelRpc } from "../rpc"
import { linkedTo, madePrimary, unlinked } from "./groups"

interface SignalTarget {
	readonly organizationId: OrganizationId
	readonly signalId: CustomerSignalId
}

/** Who acts: recorded on the optimistic row like the server records it. */
interface Actor {
	readonly userId: UserId
}

/** When the action happens, read when it runs: the optimistic row's timestamps. */
interface Stamp {
	readonly at: Date
}

/** The payloads with optional keys, built field by field so an absent one stays absent. */
interface SnoozePayload {
	organizationId: OrganizationId
	signalId: CustomerSignalId
	until: Date
	note?: string
}
interface DonePayload {
	organizationId: OrganizationId
	signalId: CustomerSignalId
	outcome: Customers.SignalOutcome
	note?: string
}
interface NoteCreatePayload {
	organizationId: OrganizationId
	id: CustomerNoteId
	accountId: CustomerAccountId
	body: string
	pinned?: boolean
	signalId?: CustomerSignalId
}
interface NoteUpdatePayload {
	organizationId: OrganizationId
	noteId: CustomerNoteId
	body?: string
	pinned?: boolean
}
interface AccountUpdatePayload {
	organizationId: OrganizationId
	accountId: CustomerAccountId
	ownerUserId?: UserId | null
	tags?: ReadonlyArray<string>
	lifecycleStageOverride?: Customers.LifecycleStage | null
	name?: string
}
interface BulkUpdatePayload {
	organizationId: OrganizationId
	accountIds: ReadonlyArray<CustomerAccountId>
	ownerUserId?: UserId | null
	addTags?: ReadonlyArray<string>
	removeTags?: ReadonlyArray<string>
}

/** Runs `action` with the current time added to its props. */
const stamped =
	<Props, A, E, R>(action: (props: Props & Stamp) => Effect.Effect<A, E, R>) =>
	(props: Props): Effect.Effect<A, E, R> =>
		Effect.flatMap(Clock.currentTimeMillis, (ms) => action({ ...props, at: new Date(ms) }))

// SIGNALS

/** Assign the signal (null: unassign). */
export const assignSignalAction = optimisticAction({
	collections: [customerSignalCollection],
	onMutate: (props: SignalTarget & { readonly assigneeUserId: UserId | null }) => {
		customerSignalCollection.update(props.signalId, (signal) => {
			signal.assigneeUserId = props.assigneeUserId
		})
		return { signalId: props.signalId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.signal.assign", {
				organizationId: props.organizationId,
				signalId: props.signalId,
				assigneeUserId: props.assigneeUserId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

type SnoozeProps = SignalTarget & Actor & { readonly until: Date; readonly note?: string }

const snoozeSignal = optimisticAction({
	collections: [customerSignalCollection],
	onMutate: (props: SnoozeProps & Stamp) => {
		customerSignalCollection.update(props.signalId, (signal) => {
			signal.status = "snoozed"
			signal.snoozedUntil = props.until
			signal.snoozedAt = props.at
			signal.snoozedByUserId = props.userId
			signal.snoozeNote = props.note ?? null
		})
		return { signalId: props.signalId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const payload: SnoozePayload = {
				organizationId: props.organizationId,
				signalId: props.signalId,
				until: props.until,
			}
			if (props.note !== undefined) payload.note = props.note
			const result = yield* client("customers.signal.snooze", payload)
			return { data: result, transactionId: result.transactionId }
		}),
})

/** Snooze until `until`; it wakes then, or earlier if it gets worse. */
export const snoozeSignalAction = stamped(snoozeSignal)

type DoneProps = SignalTarget & Actor & { readonly outcome: Customers.SignalOutcome; readonly note?: string }

const markSignalDone = optimisticAction({
	collections: [customerSignalCollection],
	onMutate: (props: DoneProps & Stamp) => {
		customerSignalCollection.update(props.signalId, (signal) => {
			signal.status = "done"
			signal.outcome = props.outcome
			signal.resolutionNote = props.note ?? null
			signal.resolvedAt = props.at
			signal.resolvedByUserId = props.userId
		})
		return { signalId: props.signalId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const payload: DonePayload = {
				organizationId: props.organizationId,
				signalId: props.signalId,
				outcome: props.outcome,
			}
			if (props.note !== undefined) payload.note = props.note
			const result = yield* client("customers.signal.done", payload)
			return { data: result, transactionId: result.transactionId }
		}),
})

/** Mark done with an outcome; it reopens after the cooldown if the condition still holds. */
export const markSignalDoneAction = stamped(markSignalDone)

/** Undo a snooze, done or dismiss (back to open). */
export const reopenSignalAction = optimisticAction({
	collections: [customerSignalCollection],
	onMutate: (props: SignalTarget) => {
		customerSignalCollection.update(props.signalId, (signal) => {
			signal.status = "open"
			signal.snoozedUntil = null
			signal.resolvedAt = null
			signal.resolvedByUserId = null
			signal.outcome = null
			signal.resolutionNote = null
			signal.dismissReason = null
		})
		return { signalId: props.signalId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.signal.reopen", {
				organizationId: props.organizationId,
				signalId: props.signalId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

// NOTES

interface NoteDraft {
	readonly organizationId: OrganizationId
	readonly accountId: CustomerAccountId
	readonly authorUserId: UserId
	readonly body: string
	readonly pinned?: boolean
	readonly signalId?: CustomerSignalId
}

const createNote = optimisticAction({
	collections: [customerNoteCollection],
	onMutate: (props: NoteDraft & Stamp & { readonly noteId: CustomerNoteId }) => {
		customerNoteCollection.insert({
			id: props.noteId,
			organizationId: props.organizationId,
			accountId: props.accountId,
			authorUserId: props.authorUserId,
			body: props.body,
			pinned: props.pinned ?? false,
			signalId: props.signalId ?? null,
			editedAt: null,
			createdAt: props.at,
			updatedAt: props.at,
			deletedAt: null,
		})
		return { noteId: props.noteId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const payload: NoteCreatePayload = {
				organizationId: props.organizationId,
				id: props.noteId,
				accountId: props.accountId,
				body: props.body,
			}
			if (props.pinned !== undefined) payload.pinned = props.pinned
			if (props.signalId !== undefined) payload.signalId = props.signalId
			const result = yield* client("customers.note.create", payload)
			return { data: result.data, transactionId: result.transactionId }
		}),
})

/** Adds a note (a client id, so the optimistic row is the one the server confirms). */
export const createNoteAction = (props: NoteDraft) =>
	Effect.flatMap(
		Effect.sync(() => CustomerNoteId.make(crypto.randomUUID())),
		(noteId) => stamped(createNote)({ ...props, noteId }),
	)

type NoteEdit = {
	readonly organizationId: OrganizationId
	readonly noteId: CustomerNoteId
	readonly body?: string
	readonly pinned?: boolean
}

const updateNote = optimisticAction({
	collections: [customerNoteCollection],
	onMutate: (props: NoteEdit & Stamp) => {
		customerNoteCollection.update(props.noteId, (note) => {
			if (props.body !== undefined) {
				note.body = props.body
				note.editedAt = props.at
			}
			if (props.pinned !== undefined) note.pinned = props.pinned
		})
		return { noteId: props.noteId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const payload: NoteUpdatePayload = { organizationId: props.organizationId, noteId: props.noteId }
			if (props.body !== undefined) payload.body = props.body
			if (props.pinned !== undefined) payload.pinned = props.pinned
			const result = yield* client("customers.note.update", payload)
			return { data: result.data, transactionId: result.transactionId }
		}),
})

/** Edit the body (the author) and/or pin (anyone). */
export const updateNoteAction = stamped(updateNote)

export const deleteNoteAction = optimisticAction({
	collections: [customerNoteCollection],
	onMutate: (props: { readonly organizationId: OrganizationId; readonly noteId: CustomerNoteId }) => {
		customerNoteCollection.delete(props.noteId)
		return { noteId: props.noteId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.note.delete", {
				organizationId: props.organizationId,
				noteId: props.noteId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

// ACCOUNTS

/** Owner, tags, stage override (null clears it) or name; only the fields given change. */
interface AccountUpdate {
	readonly organizationId: OrganizationId
	readonly accountId: CustomerAccountId
	readonly ownerUserId?: UserId | null
	readonly tags?: ReadonlyArray<string>
	readonly lifecycleStageOverride?: Customers.LifecycleStage | null
	readonly name?: string
}

/** `customers.account.update`'s payload: only the fields given. */
export const accountUpdatePayload = (props: AccountUpdate): AccountUpdatePayload => {
	const payload: AccountUpdatePayload = { organizationId: props.organizationId, accountId: props.accountId }
	if (props.ownerUserId !== undefined) payload.ownerUserId = props.ownerUserId
	if (props.tags !== undefined) payload.tags = props.tags
	if (props.lifecycleStageOverride !== undefined)
		payload.lifecycleStageOverride = props.lifecycleStageOverride
	if (props.name !== undefined) payload.name = props.name
	return payload
}

export const updateAccountAction = optimisticAction({
	collections: [customerAccountCollection],
	onMutate: (props: AccountUpdate) => {
		customerAccountCollection.update(props.accountId, (account) => {
			if (props.ownerUserId !== undefined) account.ownerUserId = props.ownerUserId
			if (props.tags !== undefined) account.tags = [...props.tags]
			if (props.name !== undefined) account.name = props.name
			if (props.lifecycleStageOverride !== undefined) {
				account.lifecycleStageOverride = props.lifecycleStageOverride
				// The derived stage shows once compute runs again; until then keep the current one.
				if (props.lifecycleStageOverride !== null)
					account.lifecycleStage = props.lifecycleStageOverride
			}
		})
		return { accountId: props.accountId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.account.update", accountUpdatePayload(props))
			return { data: result, transactionId: result.transactionId }
		}),
})

// GROUPS

interface AccountTarget {
	readonly organizationId: OrganizationId
	readonly accountId: CustomerAccountId
}

/** Points the org's live accounts at their primaries as `regroup` (`groups.ts`) says the store will. */
const applyGrouping = (
	organizationId: OrganizationId,
	regroup: (accounts: ReadonlyArray<Customers.Account>) => ReadonlyArray<Customers.Account>,
) => {
	const accounts = customerAccountCollection.toArray.filter(
		(account) => account.organizationId === organizationId && account.deletedAt === null,
	)
	regroup(accounts).forEach((next, index) => {
		if (next.primaryAccountId !== accounts[index]?.primaryAccountId)
			customerAccountCollection.update(next.id, (account) => {
				account.primaryAccountId = next.primaryAccountId
			})
	})
}

/** `customers.account.link`: the account (and its environments) join `primaryAccountId`'s customer. */
export const linkAccountAction = optimisticAction({
	collections: [customerAccountCollection],
	onMutate: (props: AccountTarget & { readonly primaryAccountId: CustomerAccountId }) => {
		applyGrouping(props.organizationId, (accounts) =>
			linkedTo(accounts, props.accountId, props.primaryAccountId),
		)
		return { accountId: props.accountId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.account.link", props)
			return { data: result, transactionId: result.transactionId }
		}),
})

/** `customers.account.unlink`: an environment stands alone again. */
export const unlinkAccountAction = optimisticAction({
	collections: [customerAccountCollection],
	onMutate: (props: AccountTarget) => {
		applyGrouping(props.organizationId, (accounts) => unlinked(accounts, props.accountId))
		return { accountId: props.accountId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.account.unlink", props)
			return { data: result, transactionId: result.transactionId }
		}),
})

/** `customers.account.setPrimary`: an environment becomes its customer's primary. */
export const setPrimaryAccountAction = optimisticAction({
	collections: [customerAccountCollection],
	onMutate: (props: AccountTarget) => {
		applyGrouping(props.organizationId, (accounts) => madePrimary(accounts, props.accountId))
		return { accountId: props.accountId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.account.setPrimary", props)
			return { data: result, transactionId: result.transactionId }
		}),
})

/** `customers.account.setEnvironment`: names the account's environment; null clears it. */
export const setEnvironmentAction = optimisticAction({
	collections: [customerAccountCollection],
	onMutate: (props: AccountTarget & { readonly environment: string | null }) => {
		customerAccountCollection.update(props.accountId, (account) => {
			account.environment = props.environment
		})
		return { accountId: props.accountId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.account.setEnvironment", props)
			return { data: result, transactionId: result.transactionId }
		}),
})

/** `customers.account.bulkUpdate`'s limit on ids per call. */
export const BULK_BATCH = 500

interface BulkUpdate {
	readonly organizationId: OrganizationId
	readonly accountIds: ReadonlyArray<CustomerAccountId>
	readonly ownerUserId?: UserId | null
	readonly addTags?: ReadonlyArray<string>
	readonly removeTags?: ReadonlyArray<string>
}

/** `customers.account.bulkUpdate`'s payloads: BULK_BATCH ids each, only the fields given. */
export const bulkUpdatePayloads = (
	props: BulkUpdate,
): readonly [BulkUpdatePayload, ...Array<BulkUpdatePayload>] => {
	const payloadOf = (start: number): BulkUpdatePayload => {
		const payload: BulkUpdatePayload = {
			organizationId: props.organizationId,
			accountIds: props.accountIds.slice(start, start + BULK_BATCH),
		}
		if (props.ownerUserId !== undefined) payload.ownerUserId = props.ownerUserId
		if (props.addTags !== undefined) payload.addTags = props.addTags
		if (props.removeTags !== undefined) payload.removeTags = props.removeTags
		return payload
	}
	const rest: Array<BulkUpdatePayload> = []
	for (let start = BULK_BATCH; start < props.accountIds.length; start += BULK_BATCH)
		rest.push(payloadOf(start))
	return [payloadOf(0), ...rest]
}

/**
 * The list's bulk actions: one owner (null: unassign) and/or tags added and removed, in batches of
 * BULK_BATCH run in order; `data.updated` is how many the server changed, and the last batch's
 * transaction is awaited (the org's stream delivers them in order).
 */
export const bulkUpdateAccountsAction = optimisticAction({
	collections: [customerAccountCollection],
	onMutate: (props: BulkUpdate) => {
		const removed = new Set(props.removeTags ?? [])
		customerAccountCollection.update([...props.accountIds], (accounts) => {
			for (const account of accounts) {
				if (props.ownerUserId !== undefined) account.ownerUserId = props.ownerUserId
				if (props.addTags !== undefined || props.removeTags !== undefined) {
					const tags = new Set([...account.tags, ...(props.addTags ?? [])])
					account.tags = [...tags].filter((tag) => !removed.has(tag))
				}
			}
		})
		return { count: props.accountIds.length }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const [first, ...rest] = bulkUpdatePayloads(props)
			let { updated, transactionId } = yield* client("customers.account.bulkUpdate", first)
			for (const payload of rest) {
				const result = yield* client("customers.account.bulkUpdate", payload)
				updated += result.updated
				transactionId = result.transactionId
			}
			return { data: { updated }, transactionId }
		}),
})

// IMPERSONATION

interface ImpersonatorGrant {
	readonly organizationId: OrganizationId
	readonly userId: UserId
	/** The admin granting: recorded on the optimistic row like the server records it. */
	readonly grantedBy: UserId
}

/** The server keeps the client's id, so the synced row replaces the optimistic one. */
const grantImpersonator = optimisticAction({
	collections: [customerImpersonatorCollection],
	onMutate: (props: ImpersonatorGrant & Stamp & { readonly id: CustomerImpersonatorId }) => {
		customerImpersonatorCollection.insert({
			id: props.id,
			organizationId: props.organizationId,
			userId: props.userId,
			grantedBy: props.grantedBy,
			createdAt: props.at,
			updatedAt: props.at,
		})
		return { id: props.id }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.impersonator.grant", {
				id: props.id,
				organizationId: props.organizationId,
				userId: props.userId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

/** Let a member sign in as customers' users (Clerk impersonation). */
export const grantImpersonatorAction = (props: ImpersonatorGrant) =>
	Effect.flatMap(
		Effect.sync(() => CustomerImpersonatorId.make(crypto.randomUUID())),
		(id) => stamped(grantImpersonator)({ ...props, id }),
	)

/** Take a member's grant back. */
export const revokeImpersonatorAction = optimisticAction({
	collections: [customerImpersonatorCollection],
	onMutate: (props: {
		readonly organizationId: OrganizationId
		readonly impersonatorId: CustomerImpersonatorId
		readonly userId: UserId
	}) => {
		customerImpersonatorCollection.delete(props.impersonatorId)
		return { impersonatorId: props.impersonatorId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.impersonator.revoke", {
				organizationId: props.organizationId,
				userId: props.userId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

// FEATURE FLAGS

interface FeatureFlagsChange {
	readonly organizationId: OrganizationId
	readonly accountIds: ReadonlyArray<CustomerAccountId>
	readonly keys: ReadonlyArray<string>
	/** On: `true` on each account; off: the key removed. */
	readonly enabled: boolean
}

/**
 * Turn `keys` on or off for every account, in Clerk then in the store (`customers.featureFlags.set`).
 * On `CustomerFeatureFlagsError` the server kept what Clerk accepted; the stream brings it back.
 */
export const setFeatureFlagsAction = optimisticAction({
	collections: [customerAccountCollection],
	onMutate: (props: FeatureFlagsChange) => {
		customerAccountCollection.update([...props.accountIds], (accounts) => {
			for (const account of accounts) {
				const next = { ...account.featureFlags }
				for (const key of props.keys) {
					if (props.enabled) next[key] = true
					else delete next[key]
				}
				account.featureFlags = next
			}
		})
		return { count: props.accountIds.length }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.featureFlags.set", {
				organizationId: props.organizationId,
				accountIds: props.accountIds,
				keys: props.keys,
				enabled: props.enabled,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

const createFeatureFlag = optimisticAction({
	collections: [customerFeatureFlagCollection],
	onMutate: (
		props: Stamp & {
			readonly organizationId: OrganizationId
			readonly id: CustomerFeatureFlagId
			readonly key: string
			readonly createdBy: UserId
		},
	) => {
		customerFeatureFlagCollection.insert({
			id: props.id,
			organizationId: props.organizationId,
			key: props.key,
			createdBy: props.createdBy,
			createdAt: props.at,
		})
		return { id: props.id }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.featureFlag.create", {
				organizationId: props.organizationId,
				id: props.id,
				key: props.key,
			})
			return { data: result.data, transactionId: result.transactionId }
		}),
})

/** A flag no customer holds yet (a client id, so the optimistic row is the one the server confirms). */
export const createFeatureFlagAction = (props: {
	readonly organizationId: OrganizationId
	readonly key: string
	readonly createdBy: UserId
}) =>
	Effect.flatMap(
		Effect.sync(() => CustomerFeatureFlagId.make(crypto.randomUUID())),
		(id) => stamped(createFeatureFlag)({ ...props, id }),
	)

/** Remove the flag from every customer in Clerk, then forget it (`customers.featureFlag.delete`). */
export const deleteFeatureFlagAction = optimisticAction({
	collections: [customerAccountCollection, customerFeatureFlagCollection],
	onMutate: (props: { readonly organizationId: OrganizationId; readonly key: string }) => {
		const holders = customerAccountCollection.toArray.filter(
			(account) =>
				account.organizationId === props.organizationId &&
				Object.hasOwn(account.featureFlags, props.key),
		)
		if (holders.length > 0) {
			customerAccountCollection.update(
				holders.map((account) => account.id),
				(accounts) => {
					for (const account of accounts) {
						const { [props.key]: _, ...rest } = account.featureFlags
						account.featureFlags = rest
					}
				},
			)
		}
		const created = customerFeatureFlagCollection.toArray.filter(
			(flag) => flag.organizationId === props.organizationId && flag.key === props.key,
		)
		if (created.length > 0) customerFeatureFlagCollection.delete(created.map((flag) => flag.id))
		return { key: props.key }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.featureFlag.delete", {
				organizationId: props.organizationId,
				key: props.key,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})
