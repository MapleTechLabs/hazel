/**
 * Test helpers for the Customers area: hand-built facts for the pure parts (evaluation, health,
 * lifecycle), and a `CustomersObject` with members over node SQLite for the object tests.
 */
import type { schema } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import {
	type Day,
	DEFAULT_CONNECTION_CONFIG,
	type IngestOp,
	type SignalEvidence,
} from "@hazel/domain/customers"
import type {
	CustomerAccountId,
	CustomerConnectionId,
	CustomerContactId,
	CustomerSignalId,
	CustomerSignalRuleId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Cause, Effect, Exit } from "effect"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../../rpc/dispatch"
import { customersTarget } from "../kinds"
import { encodeInvokePrincipal } from "../principal"
import { makeTestObjects, type TestObject, type TestObjects } from "../testing"
import type { AccountFacts, ContactFacts, OrgFacts } from "./facts"
import { customerIngest } from "./ingest-live"
import { addDays, dayOf } from "./time"

export const uuid = () => crypto.randomUUID()

// ---------------------------------------------------------------------------
// Pure fixtures
// ---------------------------------------------------------------------------

export const NOW = new Date("2026-06-15T12:00:00.000Z")
export const TODAY: Day = dayOf(NOW)

export const accountRow = (overrides: Partial<schema.CustomerAccount> = {}): schema.CustomerAccount => ({
	id: uuid() as CustomerAccountId,
	organizationId: uuid() as OrganizationId,
	name: "Acme",
	domains: ["acme.com"],
	logoUrl: null,
	ownerUserId: null,
	lifecycleStage: "active",
	lifecycleStageOverride: null,
	planName: "Team",
	mrrMinor: 19_900,
	currency: "usd",
	trialListMrrMinor: null,
	trialEndsAt: null,
	healthScore: null,
	healthStatus: "unknown",
	healthUpdatedAt: null,
	seatsUsed: null,
	seatsLimit: null,
	contactCount: 0,
	activeUsers30d: 0,
	activeUsersTrendPct: null,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	championContactId: null,
	championInactiveSince: null,
	lastActiveContactId: null,
	firstSeenAt: new Date(NOW.getTime() - 200 * 86_400_000),
	lastActiveAt: null,
	customerSince: null,
	churnedAt: null,
	tags: [],
	attributes: {},
	fieldSources: {},
	createdAt: NOW,
	updatedAt: NOW,
	deletedAt: null,
	...overrides,
})

export interface FactsInput {
	readonly account?: Partial<schema.CustomerAccount>
	/** contact name → the day offsets (0 = today, -3 = three days ago) it was active. */
	readonly activity?: Record<string, ReadonlyArray<number>>
	/** Contacts never active. */
	readonly idle?: ReadonlyArray<string>
	readonly subscriptions?: ReadonlyArray<Partial<schema.CustomerSubscription>>
	readonly openInvoices?: ReadonlyArray<Partial<schema.CustomerInvoice>>
	readonly metrics?: AccountFacts["metrics"]
	readonly movements?: ReadonlyArray<Partial<schema.CustomerMrrMovement>>
	readonly health?: AccountFacts["health"]
	readonly priorActive?: ReadonlyArray<readonly [number, number]>
}

const contactId = (name: string) => `contact-${name}` as CustomerContactId

/** Facts as the snapshot loader would build them, from day offsets relative to `NOW`. */
export const factsOf = (input: FactsInput = {}): AccountFacts => {
	const activity = new Map<Day, Map<CustomerContactId, number>>()
	const contacts: Array<ContactFacts> = []
	for (const [name, offsets] of Object.entries(input.activity ?? {})) {
		for (const offset of offsets) {
			const day = addDays(TODAY, offset)
			const map = activity.get(day) ?? new Map()
			map.set(contactId(name), 10)
			activity.set(day, map)
		}
		const last = offsets.length === 0 ? null : addDays(TODAY, Math.max(...offsets))
		contacts.push({
			id: contactId(name),
			name,
			email: `${name}@acme.com`,
			role: null,
			firstActiveAt:
				offsets.length === 0 ? null : new Date(`${addDays(TODAY, Math.min(...offsets))}T00:00:00Z`),
			lastActiveDay: last,
		})
	}
	for (const name of input.idle ?? []) {
		contacts.push({
			id: contactId(name),
			name,
			email: null,
			role: null,
			firstActiveAt: null,
			lastActiveDay: null,
		})
	}
	const lastActiveDay = contacts.reduce<Day | null>(
		(max, contact) =>
			contact.lastActiveDay !== null && (max === null || contact.lastActiveDay > max)
				? contact.lastActiveDay
				: max,
		null,
	)
	const account = accountRow({
		lastActiveAt: lastActiveDay === null ? null : new Date(`${lastActiveDay}T00:00:00Z`),
		...input.account,
	})
	return {
		account,
		stage: account.lifecycleStageOverride ?? account.lifecycleStage,
		contacts,
		activity,
		lastActiveDay,
		everActiveContacts: contacts.filter((contact) => contact.firstActiveAt !== null).length,
		priorActive: new Map(input.priorActive ?? []),
		subscriptions: (input.subscriptions ?? []).map((sub) => ({
			id: uuid() as never,
			accountId: account.id,
			provider: "stripe",
			externalId: uuid(),
			planName: "Team",
			status: "active",
			mrrMinor: 19_900,
			listMrrMinor: null,
			currency: "usd",
			interval: "month",
			quantity: 1,
			startedAt: new Date(NOW.getTime() - 100 * 86_400_000),
			trialEndsAt: null,
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
			canceledAt: null,
			cancellationReason: null,
			paymentMethod: null,
			createdAt: NOW,
			updatedAt: NOW,
			...sub,
		})),
		openInvoices: (input.openInvoices ?? []).map((invoice) => ({
			id: uuid() as never,
			accountId: account.id,
			subscriptionId: null,
			provider: "stripe",
			externalId: uuid(),
			number: "INV-1",
			status: "open",
			amountDueMinor: 19_900,
			amountPaidMinor: 0,
			currency: "usd",
			issuedAt: null,
			dueAt: null,
			paidAt: null,
			attemptCount: 1,
			nextRetryAt: null,
			declineReason: null,
			hostedUrl: null,
			createdAt: NOW,
			updatedAt: NOW,
			...invoice,
		})),
		metrics: input.metrics ?? new Map(),
		movements: (input.movements ?? []).map((movement) => ({
			id: uuid() as never,
			accountId: account.id,
			day: TODAY,
			type: "contraction",
			deltaMinor: 0,
			fromMrrMinor: 0,
			toMrrMinor: 0,
			currency: "usd",
			createdAt: NOW,
			...movement,
		})),
		health: input.health ?? [],
	}
}

export const orgFacts = (overrides: Partial<OrgFacts> = {}): OrgFacts => ({
	now: NOW,
	today: TODAY,
	connected: new Set(["clerk", "stripe", "autumn", "maple"]),
	metricNames: new Map([["active_users", "Daily active users"]]),
	currency: "usd",
	...overrides,
})

export const signalRow = (
	overrides: Partial<schema.CustomerSignal> & { readonly evidence: SignalEvidence },
): schema.CustomerSignal => ({
	id: uuid() as CustomerSignalId,
	organizationId: uuid() as OrganizationId,
	accountId: uuid() as CustomerAccountId,
	ruleId: uuid() as CustomerSignalRuleId,
	template: "inactive",
	kind: "risk",
	severity: "medium",
	status: "open",
	title: "Stopped using the product",
	reason: "",
	openingEvidence: overrides.evidence,
	actionEvidence: null,
	priorityScore: 0,
	firstDetectedAt: NOW,
	openedAt: NOW,
	lastEvaluatedAt: NOW,
	assigneeUserId: null,
	snoozedUntil: null,
	snoozedByUserId: null,
	snoozedAt: null,
	snoozeNote: null,
	resolvedAt: null,
	resolvedByUserId: null,
	outcome: null,
	resolutionNote: null,
	dismissReason: null,
	reopenAfter: null,
	reopenCount: 0,
	closedAt: null,
	createdAt: NOW,
	updatedAt: NOW,
	...overrides,
})

// ---------------------------------------------------------------------------
// Object fixtures
// ---------------------------------------------------------------------------

const userOf = (id: string) =>
	new CurrentUser.Schema({
		id: id as UserId,
		role: "member",
		email: `${id}@example.com`,
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

export interface CustomersWorld {
	readonly objects: TestObjects
	readonly object: TestObject
	readonly orgId: OrganizationId
	readonly owner: UserId
	readonly member: UserId
	readonly stranger: UserId
	/** Invoke an RPC as `user`; the decoded exit. */
	readonly call: (
		tag: HazelRpcTag,
		payload: Record<string, unknown>,
		user: UserId,
	) => Effect.Effect<Exit.Exit<any, unknown>>
	/** Raw SQL rows of the object's store. */
	readonly rows: <T = Record<string, unknown>>(
		query: string,
		...params: Array<string | number | null>
	) => Array<T>
	/** Apply ops as `provider`'s (fake, active) connection. */
	readonly ingest: (
		provider: "clerk" | "stripe" | "autumn" | "maple",
		ops: ReadonlyArray<IngestOp>,
	) => Effect.Effect<any>
	readonly connection: (provider: "clerk" | "stripe" | "autumn" | "maple") => CustomerConnectionId
}

/** A `CustomersObject` whose members are an owner and a member, bootstrapped (defaults installed). */
export const makeCustomersWorld = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const orgId = uuid() as OrganizationId
	const object = yield* objects.get(customersTarget(orgId))
	const [owner, member, stranger] = [uuid(), uuid(), uuid()] as Array<UserId>
	yield* object.applyEffect({
		objectId: orgId,
		kind: "customers.setMembers",
		payload: {
			organizationId: orgId,
			members: [
				{ userId: owner, role: "owner" },
				{ userId: member, role: "member" },
			],
			version: 1,
		},
		key: uuid(),
		sender: { kind: "org", id: orgId },
	})
	const call: CustomersWorld["call"] = (tag, payload, user) =>
		Effect.gen(function* () {
			const rpc = yield* rpcFor(tag)
			const response = yield* object.invoke({
				objectId: orgId,
				tag,
				payload: yield* encodePayload(rpc, { organizationId: orgId, ...payload }),
				principal: yield* encodeInvokePrincipal({ user: userOf(user), botScopes: null }),
			})
			return yield* decodeExit(rpc, structuredClone(response).exit)
		}).pipe(Effect.orDie)
	// The first request bootstraps the object (defaults, members).
	yield* call("customers.ignoreRules.list", {}, owner)
	const rows = <T>(query: string, ...params: Array<string | number | null>) =>
		object.storage.db.prepare(query).all(...params) as Array<T>
	const connections = new Map<string, CustomerConnectionId>()
	for (const provider of ["clerk", "stripe", "autumn", "maple"] as const) {
		const id = uuid() as CustomerConnectionId
		object.storage.db
			.prepare(
				`INSERT INTO customer_connections (id, organizationId, provider, config, connectedBy) VALUES (?, ?, ?, ?, ?)`,
			)
			.run(id, orgId, provider, JSON.stringify(DEFAULT_CONNECTION_CONFIG[provider]), owner)
		connections.set(provider, id)
	}
	const connection = (provider: "clerk" | "stripe" | "autumn" | "maple") => connections.get(provider)!
	const ingest = (provider: "clerk" | "stripe" | "autumn" | "maple", ops: ReadonlyArray<IngestOp>) =>
		object
			.run(
				Effect.gen(function* () {
					const service = yield* customerIngest
					return yield* service.apply(
						{ connectionId: connection(provider), provider, runId: null, trigger: "manual" },
						ops,
					)
				}),
			)
			.pipe(Effect.orDie)
	return {
		objects,
		object,
		orgId,
		owner,
		member,
		stranger,
		call,
		rows,
		ingest,
		connection,
	} satisfies CustomersWorld
})

export const ok = <A>(exit: Exit.Exit<A, unknown>): A => {
	if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause))
	return exit.value
}

/** The failure's `_tag`, or `"Success"`. */
export const tagOf = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isSuccess(exit)
		? "Success"
		: (() => {
				const error = Cause.findErrorOption(exit.cause)
				return error._tag === "Some" ? (error.value as { _tag: string })._tag : "Defect"
			})()
