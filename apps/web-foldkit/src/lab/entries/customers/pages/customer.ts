import type * as Customers from "@hazel/domain/customers"
import {
	CustomerContactId,
	CustomerEventId,
	CustomerInvoiceId,
	CustomerNoteId,
	CustomerSubscriptionId,
} from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { toAccountRow, toSignalRow } from "../../../../customers/queries"
import { labShared } from "../../../../page/customers/lab-shared"
import { Message } from "../../../../page/customers/detail/message"
import { Model, type NoteRow } from "../../../../page/customers/detail/model"
import { init, routeChanged, update } from "../../../../page/customers/detail/update"
import { view } from "../../../../page/customers/detail/view"
import { AppRoute, CustomerTab } from "../../../../route"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import {
	ACCOUNTS,
	ACCOUNTS_BY_KEY,
	ACME_DETAIL,
	CONNECTIONS,
	JONAS,
	MAYA,
	NOW,
	SIGNALS,
	TEAM,
	dayOf,
} from "../../../fixtures/customers"

// `/lab/customers/pages/customer`: the real customer page over Acme Robotics. Its update runs; every
// read answers from the fixtures below, the mutations apply to the rows at once and go nowhere.
// `?tab=` picks the tab, `?state=` the Wonder artboard's data.

const STATES = ["default", "payment-failed", "excluded-health", "loading", "not-found"] as const
const State = Schema.Literals(STATES)
const Flags = Schema.Struct({ tab: CustomerTab, state: State })

const DAY = 86_400_000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)
const uuid = (kind: number, n: number) =>
	`${String(kind).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`
const acme = ACCOUNTS_BY_KEY.acme

// FIXTURES

const PEOPLE: ReadonlyArray<readonly [string, string, string, number | null, number]> = [
	["Priya Shah", "Head of Automation", "admin", 16, 6],
	["Daniel Okafor", "Engineering Lead", "member", 0, 18],
	["Mei Tanaka", "Robotics Engineer", "member", 1, 14],
	["Lucas Ferreira", "IT Manager", "admin", 1, 11],
	["Hannah Weiss", "Process Engineer", "member", 2, 9],
	["Omar Haddad", "Controls Engineer", "member", 6, 5],
	["Sofia Romano", "Operations Analyst", "member", 9, 4],
	["Ben Carter", "Field Technician", "member", 19, 3],
	["Ines Duarte", "QA Engineer", "member", 27, 1],
	["Marcus Lee", "Automation Engineer", "member", 43, 0],
	["Elena Petrova", "Data Analyst", "member", 56, 0],
	["Tom Becker", "Plant Manager", "member", 72, 0],
	["Aisha Bello", "VP Operations", "admin", 90, 0],
	["Ryan Gallagher", "Maintenance Lead", "member", 112, 0],
	["Kenji Sato", "Robotics Engineer", "member", null, 0],
	["Laura Kim", "Robotics Engineer", "member", null, 0],
	["Victor Alvarez", "Controls Engineer", "member", null, 0],
]

const CONTACTS: ReadonlyArray<Customers.ContactRow> = PEOPLE.map(
	([name, title, role, seenDays, signIns], index) => {
		const email = `${name.split(" ")[0].toLowerCase()}@acmerobotics.io`
		return {
			contact: {
				id: Schema.decodeSync(CustomerContactId)(uuid(30, 100 + index)),
				accountId: acme.id,
				email,
				name,
				avatarUrl: null,
				title,
				role: role === "admin" ? "Admin" : "Member",
				isBillingContact: index === 3,
				joinedAt: ago(seenDays === null ? 10 + index : 400),
				firstActiveAt: seenDays === null ? null : ago(399),
				lastSeenAt: seenDays === null ? null : ago(seenDays),
				lastSignInAt: seenDays === null ? null : ago(seenDays),
				signInCount30d: signIns,
				eventCount30d: signIns * 40,
				attributes: {},
				fieldSources: { email: "clerk" },
				createdAt: ago(400),
				updatedAt: ago(1),
				deletedAt: null,
			},
			status: seenDays === null ? "never_active" : seenDays <= 30 ? "active" : "dormant",
			activity: Array.from({ length: 30 }, (_, day) => ({
				day: dayOf(29 - day),
				value: seenDays !== null && 29 - day >= seenDays ? (day * 7 + index * 3) % 9 : 0,
			})),
		}
	},
)

/** Acme's champion (Priya) went quiet 16 days ago. */
const ACCOUNT: Customers.Account = {
	...acme,
	lifecycleStage: "active",
	championContactId: CONTACTS[0].contact.id,
	championInactiveSince: ago(16),
	lastActiveContactId: CONTACTS[1].contact.id,
	seatsUsed: 23,
	seatsLimit: 25,
	attributes: {
		industry: "Industrial automation",
		employees: "120–250",
		country: "Germany",
		region: "eu-central-1",
	},
	fieldSources: {
		...acme.fieldSources,
		industry: "clerk",
		employees: "clerk",
		country: "stripe",
		region: "maple",
		lifecycleStage: "stripe",
	},
}

const SUBSCRIPTION = ACME_DETAIL.subscriptions[0]

const invoice = (
	n: number,
	monthsAgo: number,
	fields: Partial<Customers.Invoice> = {},
): Customers.Invoice => ({
	id: Schema.decodeSync(CustomerInvoiceId)(uuid(33, 100 + n)),
	accountId: acme.id,
	subscriptionId: SUBSCRIPTION.id,
	provider: "stripe",
	externalId: `in_acme_${n}`,
	number: `INV-${2040 - n}`,
	status: "paid",
	amountDueMinor: 215_000,
	amountPaidMinor: 215_000,
	currency: "USD",
	issuedAt: ago(monthsAgo * 30 + 9),
	dueAt: ago(monthsAgo * 30 + 9),
	paidAt: ago(monthsAgo * 30 + 9),
	attemptCount: 1,
	nextRetryAt: null,
	declineReason: null,
	hostedUrl: `https://invoice.stripe.com/i/acct_hazel/in_acme_${n}`,
	createdAt: ago(monthsAgo * 30 + 9),
	updatedAt: ago(monthsAgo * 30 + 9),
	...fields,
})

const UPCOMING: Customers.Invoice = invoice(0, 0, {
	id: Schema.decodeSync(CustomerInvoiceId)(uuid(33, 99)),
	number: null,
	status: "upcoming",
	externalId: `upcoming:${SUBSCRIPTION.externalId}`,
	issuedAt: new Date(NOW.getTime() + 21 * DAY),
	dueAt: new Date(NOW.getTime() + 21 * DAY),
	paidAt: null,
	amountPaidMinor: 0,
	hostedUrl: null,
})

const PAID_INVOICES: ReadonlyArray<Customers.Invoice> = Array.from({ length: 12 }, (_, index) =>
	invoice(index + 1, index + 1, index >= 4 ? { amountDueMinor: 124_000, amountPaidMinor: 124_000 } : {}),
)

const event = (
	n: number,
	daysAgo: number,
	provider: Customers.CustomerSource,
	type: string,
	title: string,
	data: Record<string, unknown> = {},
	actorUserId: Customers.Event["actorUserId"] = null,
): Customers.Event => ({
	id: Schema.decodeSync(CustomerEventId)(uuid(34, 100 + n)),
	accountId: acme.id,
	contactId: null,
	provider,
	type,
	title,
	data,
	occurredAt: new Date(NOW.getTime() - daysAgo * DAY - (n % 5) * 3_600_000),
	externalId: null,
	actorUserId,
	createdAt: ago(daysAgo),
})

const EVENTS: ReadonlyArray<Customers.Event> = [
	event(
		1,
		0,
		"hazel",
		"note.created",
		"Note added",
		{ body: "Emailed Lucas about the drop in daily actives." },
		JONAS.id,
	),
	event(2, 2, "hazel", "signal.opened", "Signal opened: Champion inactive", { severity: "medium" }),
	event(3, 4, "hazel", "signal.opened", "Signal opened: Usage dropped", { severity: "high" }),
	event(4, 4, "hazel", "health.status_changed", "Health changed: Healthy → At risk", { from: 71, to: 66 }),
	event(5, 9, "stripe", "invoice.paid", "Invoice paid", { number: "INV-2039", amount: "$1,240.00" }),
	event(6, 11, "clerk", "contact.joined", "2 contacts joined", { invitedBy: "Lucas Ferreira" }),
	event(7, 16, "maple", "activity.last", "Last activity from Priya Shah", { events: 46 }),
	event(8, 20, "clerk", "contact.removed", "Contact removed", { contact: "Stefan Vogel" }),
	event(9, 27, "hazel", "signal.auto_resolved", "Signal resolved: Seat growth"),
	event(10, 39, "stripe", "invoice.paid", "Invoice paid", { number: "INV-2038", amount: "$1,240.00" }),
]

const NOTES: ReadonlyArray<NoteRow> = [
	{
		id: Schema.decodeSync(CustomerNoteId)(uuid(35, 1)),
		accountId: acme.id,
		authorUserId: JONAS.id,
		body: "**Key contacts**\n\n- **Priya Shah**, Head of Automation. Champion and budget owner.\n- **Lucas Ferreira**, IT Manager. Owns seats and SSO.",
		pinned: true,
		signalId: null,
		editedAtMs: ago(11).getTime(),
		createdAtMs: ago(39).getTime(),
	},
	{
		id: Schema.decodeSync(CustomerNoteId)(uuid(35, 2)),
		accountId: acme.id,
		authorUserId: MAYA.id,
		body: "Moved from Team to **Pro** for SSO and the 25-seat bundle. Promised a check-in 90 days after the upgrade.",
		pinned: true,
		signalId: null,
		editedAtMs: null,
		createdAtMs: ago(119).getTime(),
	},
	{
		id: Schema.decodeSync(CustomerNoteId)(uuid(35, 3)),
		accountId: acme.id,
		authorUserId: MAYA.id,
		body: "Emailed Lucas about the drop. Priya is on leave until January; Daniel Okafor is covering.",
		pinned: false,
		signalId: SIGNALS.find((signal) => signal.accountId === acme.id)?.id ?? null,
		editedAtMs: null,
		createdAtMs: NOW.getTime() - 2 * 3_600_000,
	},
]

const series = (
	key: string,
	name: string,
	days: number,
	value: (day: number) => number,
): Customers.MetricSeries => ({
	metricKey: key,
	name,
	unit: null,
	limit: null,
	points: Array.from({ length: days }, (_, index) => ({
		day: dayOf(days - 1 - index),
		value: value(index),
	})),
})

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 } as const

const usageOf = (metricKey: string, range: Customers.CustomersRange) =>
	series(metricKey, metricKey === "mrr" ? "MRR" : "Active users", RANGE_DAYS[range], (day) => {
		const total = RANGE_DAYS[range]
		const late = day > total - 8
		return Math.max(1, Math.round((late ? 3 : 5) + ((day * 7) % 5) - (day % 6 === 0 ? 3 : 0)))
	})

const MRR_HISTORY = series("mrr", "MRR", 365, (day) => (day < 245 ? 62_000 : 124_000))

const detailFor = (state: typeof State.Type): Customers.AccountDetail => {
	const healthy: Customers.AccountDetail = {
		...ACME_DETAIL,
		account: ACCOUNT,
		subscriptions: [{ ...SUBSCRIPTION, status: "active", planName: "Pro", mrrMinor: 124_000 }],
		openInvoices: [],
		upcomingInvoice: UPCOMING,
		contactsToReach: CONTACTS.slice(0, 4),
		recentEvents: EVENTS.slice(0, 5),
	}
	if (state === "payment-failed")
		return {
			...healthy,
			account: { ...ACCOUNT, lifecycleStage: "past_due", healthStatus: "critical", healthScore: 34 },
			subscriptions: ACME_DETAIL.subscriptions,
			openInvoices: ACME_DETAIL.openInvoices,
		}
	if (state === "excluded-health")
		return {
			...healthy,
			subscriptions: [],
			upcomingInvoice: null,
			account: { ...ACCOUNT, healthStatus: "healthy", healthScore: 82 },
			health: {
				score: 82,
				status: "healthy",
				components: [
					{
						key: "usage",
						score: 68,
						weight: 40,
						effectiveWeight: 50,
						excluded: false,
						why: "11 of 16 contacts active in the last 30 days (69%). Daily actives flat vs the prior 28 days.",
					},
					{
						key: "engagement",
						score: 92,
						weight: 25,
						effectiveWeight: 31.25,
						excluded: false,
						why: "Last activity 20 minutes ago. Active every weekday this month.",
					},
					{
						key: "signals",
						score: 100,
						weight: 15,
						effectiveWeight: 18.75,
						excluded: false,
						why: "No open risk signals.",
					},
					{
						key: "billing",
						score: null,
						weight: 20,
						effectiveWeight: 0,
						excluded: true,
						why: "Left out: no Stripe or Autumn record is linked to this account, so its 20% is shared across the other three in proportion.",
					},
				],
			},
		}
	return healthy
}

// PROGRAM

type Return = ReturnType<typeof update>
type AnyCommand = NonNullable<Return["commands"]>[number]

const state = (): typeof State.Type => {
	const value = new URLSearchParams(window.location.search).get("state")
	return STATES.find((entry) => entry === value) ?? "default"
}

const page = <A>(items: ReadonlyArray<A>, cursor: unknown, size = 10) => {
	const offset = typeof cursor === "string" ? Number(cursor) : 0
	return {
		items: items.slice(offset, offset + size),
		nextCursor: offset + size < items.length ? String(offset + size) : null,
	}
}

/** The fixture answer to a read Command; none for a Command that stays local or goes nowhere. */
const answer = (command: AnyCommand, current: typeof State.Type): Message | null | "local" => {
	const args = (command.args ?? {}) as Record<string, unknown>
	switch (command.name) {
		case "FetchCustomerDetail":
			return current === "loading"
				? null
				: current === "not-found"
					? Message.FailedFetchDetail({ reason: "NotFound" })
					: Message.SucceededFetchDetail({ detail: detailFor(current) })
		case "FetchCustomerUsage": {
			const range = args.range as Customers.CustomersRange
			const metricKey = String(args.metricKey)
			return Message.SucceededFetchUsage({ metricKey, range, series: [usageOf(metricKey, range)] })
		}
		case "FetchCustomerMrrHistory":
			return Message.SucceededFetchMrrHistory({
				series: current === "excluded-health" ? [] : [MRR_HISTORY],
			})
		case "FetchCustomerContacts":
			return Message.SucceededFetchContacts({ page: page(CONTACTS, args.cursor, 50) })
		case "FetchCustomerInvoices":
			return Message.SucceededFetchInvoices({
				page: page(
					current === "payment-failed"
						? [...ACME_DETAIL.openInvoices, ...PAID_INVOICES]
						: PAID_INVOICES,
					args.cursor,
				),
			})
		case "FetchCustomerEvents": {
			const providers = args.providers as ReadonlyArray<string>
			const types = args.types as ReadonlyArray<string>
			const matching = EVENTS.filter(
				(entry) =>
					(providers.length === 0 || providers.includes(entry.provider)) &&
					(types.length === 0 || types.some((prefix) => entry.type.startsWith(prefix))),
			)
			return Message.SucceededFetchEvents({
				filter: String(args.filter),
				page: page(matching, args.cursor, 6),
			})
		}
		case "CreateCustomerNote":
			return null
		default:
			return command.name.startsWith("Update") ||
				command.name.startsWith("Delete") ||
				command.name.endsWith("Signal") ||
				command.name.endsWith("SignalDone")
				? null
				: "local"
	}
}

/** Runs the page's update and answers its reads from the fixtures (a new note joins the list). */
const step = (model: Model, message: Message): { model: Model; commands: ReadonlyArray<AnyCommand> } => {
	const result = update(model, message, labShared)
	return settle(result.model, result.commands ?? [])
}

const settle = (
	model: Model,
	commands: ReadonlyArray<AnyCommand>,
): { model: Model; commands: ReadonlyArray<AnyCommand> } => {
	let current = model
	const kept: Array<AnyCommand> = []
	for (const command of commands) {
		if (command.name === "CreateCustomerNote") {
			const args = (command.args ?? {}) as { body?: string; pinned?: boolean }
			const note: NoteRow = {
				id: Schema.decodeSync(CustomerNoteId)(uuid(35, 100 + (current.notes?.length ?? 0))),
				accountId: acme.id,
				authorUserId: MAYA.id,
				body: args.body ?? "",
				pinned: args.pinned ?? false,
				signalId: null,
				editedAtMs: null,
				createdAtMs: NOW.getTime(),
			}
			current = { ...current, notes: [note, ...(current.notes ?? [])] }
			continue
		}
		const reply = answer(command, state())
		if (reply === "local") kept.push(command)
		else if (reply !== null) {
			const next = step(current, reply)
			current = next.model
			kept.push(...next.commands)
		}
	}
	return { model: current, commands: kept }
}

const routeOf = (tab: CustomerTab) =>
	AppRoute.CustomerDetail({
		orgSlug: "lab",
		accountId: acme.id,
		tab: tab === "overview" ? Option.none() : Option.some(tab),
	})

const initial = (flags: typeof Flags.Type) => {
	const started = init(routeOf(flags.tab), labShared)
	const live: Model = {
		...started.model,
		accounts:
			flags.state === "not-found"
				? ACCOUNTS.filter((account) => account.id !== acme.id).map(toAccountRow)
				: ACCOUNTS.map((account) =>
						toAccountRow(account.id === acme.id ? detailFor(flags.state).account : account),
					),
		signals: SIGNALS.map(toSignalRow),
		notes: NOTES,
		members: TEAM,
		metrics: [
			{ key: "active_users", name: "Active users", unit: null },
			{ key: "mrr", name: "MRR", unit: "minor" },
			{ key: "api_requests", name: "API requests", unit: null },
		],
		connectedProviders: CONNECTIONS.map((connection) => connection.provider),
	}
	return settle(live, started.commands ?? [])
}

const labView = (model: Model, h: HtmlBuilder<Message>): Html => {
	const params = new URLSearchParams(window.location.search)
	return labPage(
		h,
		{
			title: "Customer",
			switches: [
				{ name: "tab", values: CustomerTab.literals, current: params.get("tab") ?? "overview" },
				{ name: "state", values: STATES, current: params.get("state") ?? "default" },
			],
		},
		[
			h.div(
				[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
				[
					h.submodel({
						slotId: "customer",
						model,
						view,
						viewInputs: { shared: labShared },
						toParentMessage: (message: Message) => message,
					}),
				],
			),
		],
	)
}

export const lab = defineLabWithFlags("Customer", {
	Model,
	Flags,
	flags: Effect.all({
		tab: queryParam("tab", CustomerTab.literals, "overview"),
		state: queryParam("state", STATES, "default"),
	}),
	init: initial,
	// Tabs navigate in the app; here they switch in place. Prev/next stay on Acme.
	update: (model: Model, message: Message) => {
		if (message._tag === "ClickedTab") {
			const result = routeChanged(model, routeOf(message.tab), labShared)
			return settle(result.model, result.commands ?? [])
		}
		if (message._tag === "PressedAddNote") {
			const result = routeChanged(model, routeOf("notes"), labShared)
			return settle(result.model, result.commands ?? [])
		}
		return step(model, message)
	},
	view: labView,
})
