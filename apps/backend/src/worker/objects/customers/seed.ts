/**
 * Deterministic demo data for the Customers area (`docs/customers/tech-design.md` §6.5): the
 * `IngestOp`s four fake provider connections would send, applied through ingest to fill a dev org.
 *
 * Data model, all relative to `now`'s UTC day:
 * - Clerk: one organization per account (`org_NNNN`, the shared id) and its members (`user_NNNNN`).
 * - Autumn: the billing truth. Customer id = Clerk org id; subscriptions carry the MRR, a plan
 *   change is the old subscription canceled plus a new one started the same day; metered usage
 *   (`api_calls`, `projects`, `storage_gb`) is a daily metric with the plan's limit.
 * - Stripe: a customer per billed account (`metadata.clerk_org_id` → `sameAs`) and its invoices,
 *   plus a few customers that resolve by domain, match nothing, or match two accounts.
 * - Maple: one activity row per contact per active day, weekday-heavy, with a clear champion.
 *
 * Each account gets an archetype that shapes its history so every signal template has matches:
 * `went_quiet` (inactive), `usage_drop`, `payment_failed`, `cancel_scheduled` and `downgraded`
 * (cancel_scheduled), `trial_ending_low` (trial_ending_low_activation), `onboarding_stalled`,
 * `champion_left` (champion_inactive), `near_limit`, `seat_growth`; `healthy_*`, `trial_healthy`,
 * `churned` and `lead` fill out the book (and `health_drop` follows from the risky ones).
 */
import type {
	CustomerProvider,
	IngestOp,
	ProviderRef,
	UpsertAccount,
	UpsertContact,
} from "@hazel/domain/customers"
import { DAY_MS, dayOf } from "./time"

export interface DemoSeedOptions {
	/** Number of customer accounts (default 200). */
	readonly accounts?: number
	/** PRNG seed (default 1). Same seed + same now → identical output. */
	readonly seed?: number
	/** Anchor: every date is relative to this instant's UTC day. */
	readonly now: Date
	/** Days of daily activity/usage history (default 120). */
	readonly activityDays?: number
}

export type DemoArchetype =
	| "healthy_growing"
	| "healthy_stable"
	| "went_quiet"
	| "usage_drop"
	| "payment_failed"
	| "cancel_scheduled"
	| "downgraded"
	| "trial_ending_low"
	| "trial_healthy"
	| "onboarding_stalled"
	| "champion_left"
	| "near_limit"
	| "seat_growth"
	| "churned"
	| "lead"

export interface DemoAccount {
	readonly clerkOrgId: string
	readonly name: string
	readonly archetype: DemoArchetype
}

export interface DemoSeed {
	/** Apply in this order: clerk, autumn, stripe, maple. One batch per provider. */
	readonly batches: ReadonlyArray<{
		readonly provider: CustomerProvider
		readonly ops: ReadonlyArray<IngestOp>
	}>
	readonly accounts: ReadonlyArray<DemoAccount>
}

// ---------------------------------------------------------------------------------------------
// Randomness and time

interface Rng {
	/** [0, 1) */
	readonly next: () => number
	/** Integer in [min, max]. */
	readonly int: (min: number, max: number) => number
	readonly between: (min: number, max: number) => number
	readonly chance: (p: number) => boolean
	readonly pick: <A>(items: ReadonlyArray<A>) => A
}

/** mulberry32 */
const makeRng = (seed: number): Rng => {
	let state = seed >>> 0
	const next = () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
	}
	return {
		next,
		int: (min, max) => min + Math.floor(next() * (max - min + 1)),
		between: (min, max) => min + next() * (max - min),
		chance: (p) => next() < p,
		pick: (items) => items[Math.floor(next() * items.length)],
	}
}

/** Midnights are epoch ms; "ago" is whole days before today. */
interface Clock {
	readonly now: number
	readonly today: number
}

const dayAt = (clock: Clock, ago: number) => clock.today - ago * DAY_MS
const dayKey = (ms: number) => dayOf(new Date(ms))
const iso = (ms: number) => new Date(ms).toISOString()
/** A random instant on the day starting at `dayMs`, never after now. */
const stamp = (clock: Clock, rng: Rng, dayMs: number) =>
	iso(Math.min(dayMs + rng.int(7 * 3600, 20 * 3600) * 1000, clock.now))
const isWeekend = (dayMs: number) => {
	const weekday = new Date(dayMs).getUTCDay()
	return weekday === 0 || weekday === 6
}
/** `k` months after the midnight `ms`, the day of month clamped to the month's length. */
const addMonths = (ms: number, k: number) => {
	const date = new Date(ms)
	const month = date.getUTCMonth() + k
	const lastDay = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate()
	return Date.UTC(date.getUTCFullYear(), month, Math.min(date.getUTCDate(), lastDay))
}
const pad = (n: number, width: number) => String(n).padStart(width, "0")

// ---------------------------------------------------------------------------------------------
// Catalog

interface Plan {
	readonly name: string
	readonly priceMinor: number
	readonly seats: number
	readonly apiCallsPerDay: number
	readonly projects: number | null
	readonly storageGb: number
}

const STARTER: Plan = {
	name: "Starter",
	priceMinor: 4_900,
	seats: 3,
	apiCallsPerDay: 2_000,
	projects: 3,
	storageGb: 5,
}
const TEAM: Plan = {
	name: "Team",
	priceMinor: 19_900,
	seats: 10,
	apiCallsPerDay: 20_000,
	projects: 15,
	storageGb: 50,
}
const BUSINESS: Plan = {
	name: "Business",
	priceMinor: 79_900,
	seats: 50,
	apiCallsPerDay: 150_000,
	projects: 100,
	storageGb: 500,
}
const ENTERPRISE: Plan = {
	name: "Enterprise",
	priceMinor: 0, // custom, per account
	seats: 200,
	apiCallsPerDay: 2_000_000,
	projects: null,
	storageGb: 5_000,
}
const TIERS = [STARTER, TEAM, BUSINESS, ENTERPRISE] as const
const tierBelow = (plan: Plan) => TIERS[Math.max(0, TIERS.indexOf(plan as (typeof TIERS)[number]) - 1)]
const tierAbove = (plan: Plan) => TIERS[Math.min(3, TIERS.indexOf(plan as (typeof TIERS)[number]) + 1)]

/** Accounts per archetype in a 200-account book. */
const MIX: ReadonlyArray<readonly [DemoArchetype, number]> = [
	["healthy_stable", 50],
	["healthy_growing", 25],
	["lead", 15],
	["trial_healthy", 10],
	["trial_ending_low", 6],
	["went_quiet", 10],
	["usage_drop", 10],
	["payment_failed", 8],
	["cancel_scheduled", 6],
	["downgraded", 6],
	["onboarding_stalled", 8],
	["champion_left", 8],
	["near_limit", 8],
	["seat_growth", 8],
	["churned", 22],
]

const NAME_HEADS = [
	"North",
	"Blue",
	"Bright",
	"Iron",
	"Silver",
	"Cedar",
	"Harbor",
	"Summit",
	"Atlas",
	"Lumen",
	"Pine",
	"Granite",
	"Copper",
	"Vertex",
	"Nova",
	"Orbit",
	"Quartz",
	"Maple",
	"Signal",
	"Tide",
	"Ember",
	"Falcon",
	"Meadow",
	"Delta",
	"Cobalt",
	"Prism",
	"Beacon",
	"Ridge",
	"Juniper",
	"Echo",
]
const NAME_TAILS = [
	"wind",
	"stack",
	"works",
	"forge",
	"flow",
	"grid",
	"path",
	"line",
	"base",
	"field",
	"point",
	"craft",
	"wave",
	"gate",
	"loop",
	"mark",
	"shift",
	"scale",
	"bridge",
	"light",
	"sync",
	"yard",
	"dock",
	"beam",
	"leaf",
	"stone",
	"spark",
	"vault",
	"hub",
	"nest",
]
const NAME_KINDS = [
	"",
	"",
	"",
	" Labs",
	" Systems",
	" Analytics",
	" Health",
	" Logistics",
	" Software",
	" AI",
]
const FIRST_NAMES = [
	"Ava",
	"Liam",
	"Mia",
	"Noah",
	"Emma",
	"Lucas",
	"Sofia",
	"Ethan",
	"Zoe",
	"Mateo",
	"Chloe",
	"Leo",
	"Nora",
	"Arjun",
	"Hana",
	"Omar",
	"Priya",
	"Jonas",
	"Elena",
	"Kai",
	"Maya",
	"Felix",
	"Ines",
	"Theo",
	"Aisha",
	"Daniel",
	"Lena",
	"Marco",
	"Yuki",
	"Sam",
]
const LAST_NAMES = [
	"Garcia",
	"Chen",
	"Patel",
	"Kim",
	"Muller",
	"Rossi",
	"Silva",
	"Nguyen",
	"Cohen",
	"Novak",
	"Okafor",
	"Larsen",
	"Tanaka",
	"Moreau",
	"Kowalski",
	"Haddad",
	"Fischer",
	"Reyes",
	"Singh",
	"Walsh",
	"Berg",
	"Ito",
	"Costa",
	"Ahmed",
	"Lopez",
	"Weber",
	"Kaur",
	"Brooks",
	"Duarte",
	"Sato",
]
const CHURN_REASONS = ["too_expensive", "missing_features", "switched_service", "unused", "low_quality"]
const DECLINE_REASONS = ["card_declined", "insufficient_funds", "expired_card"]

// ---------------------------------------------------------------------------------------------
// The plan: accounts, contacts and subscriptions as "days ago", before any op is written

interface ContactSpec {
	readonly externalId: string
	readonly name: string
	readonly email: string
	readonly role: "org:admin" | "org:member"
	readonly isBillingContact: boolean
	readonly joinAgo: number
	/** The most recent day it can be active (0 = today). */
	stopAgo: number
	removedAgo: number | null
	/** Chance of activity on a weekday (weekends 30% of it). */
	weekdayP: number
	readonly forced: Set<number>
}

interface SubSpec {
	readonly externalId: string
	readonly plan: Plan
	readonly mrrMinor: number
	readonly interval: "month" | "year"
	readonly start: number
	/** Canceled (or plan changed) at; null while live. */
	readonly end: number | null
	readonly status: "trialing" | "active" | "past_due" | "unpaid" | "canceled"
	readonly trialEndsAt: number | null
	readonly cancelAtPeriodEnd: boolean
	readonly cancellationReason: string | null
	/** No invoice is issued after it (an `unpaid` subscription stops billing). */
	readonly lastIssue: number | null
	readonly failure: { readonly attempts: number; readonly declineReason: string } | null
}

interface AccountSpec {
	readonly index: number
	readonly clerkOrgId: string
	readonly name: string
	readonly domain: string
	readonly archetype: DemoArchetype
	readonly createdAgo: number
	readonly contacts: Array<ContactSpec>
	readonly subs: Array<SubSpec>
	/** Daily activity multiplier on top of each contact's own rate. */
	readonly intensity: (ago: number) => number
	/** Share of the api_calls limit used on a normal day. */
	readonly usageShare: number
	/** Stripe customer carries `metadata.clerk_org_id`; false → matched by domain only. */
	stripeSameAs: boolean
}

const archetypeCounts = (total: number): Array<DemoArchetype> => {
	const exact = MIX.map(([archetype, weight]) => ({ archetype, value: (total * weight) / 200 }))
	const counts = exact.map(({ value }) => Math.floor(value))
	const byRemainder = exact
		.map(({ value }, index) => ({ index, remainder: value - Math.floor(value) }))
		.sort((a, b) => b.remainder - a.remainder || a.index - b.index)
	let missing = total - counts.reduce((sum, count) => sum + count, 0)
	for (const { index } of byRemainder) {
		if (missing === 0) break
		counts[index]++
		missing--
	}
	if (total >= 30) {
		for (const [index, count] of counts.entries()) {
			if (count === 0) {
				counts[index] = 1
				counts[0]-- // from healthy_stable
			}
		}
	}
	return MIX.flatMap(([archetype], index) => Array.from({ length: counts[index] }, () => archetype))
}

const shuffle = <A>(rng: Rng, items: Array<A>): Array<A> => {
	for (let i = items.length - 1; i > 0; i--) {
		const j = rng.int(0, i)
		;[items[i], items[j]] = [items[j], items[i]]
	}
	return items
}

const companyNames = (rng: Rng, count: number) => {
	const combos = shuffle(
		rng,
		NAME_HEADS.flatMap((head) => NAME_TAILS.map((tail) => `${head}${tail}`)),
	)
	return Array.from({ length: count }, (_, index) => {
		const round = Math.floor(index / combos.length)
		const base = `${combos[index % combos.length]}${round === 0 ? "" : ` ${round + 1}`}`
		const slug = base.toLowerCase().replace(/\s+/g, "")
		const tld = rng.chance(0.7) ? "com" : rng.chance(0.5) ? "io" : "dev"
		return { name: `${base}${rng.pick(NAME_KINDS)}`, domain: `${slug}.${tld}` }
	})
}

const weighted = <A>(rng: Rng, options: ReadonlyArray<readonly [A, number]>): A => {
	let roll = rng.next() * options.reduce((sum, [, weight]) => sum + weight, 0)
	for (const [option, weight] of options) {
		roll -= weight
		if (roll < 0) return option
	}
	return options[options.length - 1][0]
}

const pickPlan = (rng: Rng, archetype: DemoArchetype): Plan => {
	switch (archetype) {
		case "healthy_stable":
			return weighted(rng, [
				[STARTER, 30],
				[TEAM, 40],
				[BUSINESS, 22],
				[ENTERPRISE, 8],
			])
		case "healthy_growing":
			return weighted(rng, [
				[TEAM, 40],
				[BUSINESS, 40],
				[ENTERPRISE, 20],
			])
		// The plan after the downgrade.
		case "downgraded":
			return weighted(rng, [
				[STARTER, 50],
				[TEAM, 50],
			])
		case "seat_growth":
			return BUSINESS
		case "trial_healthy":
		case "trial_ending_low":
			return weighted(rng, [
				[TEAM, 60],
				[BUSINESS, 40],
			])
		case "onboarding_stalled":
			return weighted(rng, [
				[STARTER, 60],
				[TEAM, 40],
			])
		case "near_limit":
			return weighted(rng, [
				[STARTER, 30],
				[TEAM, 50],
				[BUSINESS, 20],
			])
		case "went_quiet":
		case "usage_drop":
		case "champion_left":
			return weighted(rng, [
				[TEAM, 65],
				[BUSINESS, 35],
			])
		default:
			return weighted(rng, [
				[STARTER, 35],
				[TEAM, 45],
				[BUSINESS, 20],
			])
	}
}

const contactCount = (rng: Rng, plan: Plan | null) => {
	if (plan === null) return rng.int(1, 3)
	if (plan === STARTER) return rng.int(2, 3)
	if (plan === TEAM) return rng.int(4, 9)
	if (plan === BUSINESS) return rng.int(8, 16)
	return rng.int(14, 25)
}

/** Builds every account's history; the op writers below only read it. */
const planAccounts = (
	rng: Rng,
	clock: Clock,
	archetypes: ReadonlyArray<DemoArchetype>,
	names: ReadonlyArray<{ readonly name: string; readonly domain: string }>,
): Array<AccountSpec> => {
	const emails = new Set<string>()
	let contactSeq = 0
	let subSeq = 0

	return archetypes.map((archetype, index) => {
		const { name, domain } = names[index]
		const clerkOrgId = `org_${pad(index + 1, 4)}`
		const subs: Array<SubSpec> = []
		const sub = (fields: Partial<SubSpec> & Pick<SubSpec, "plan" | "start">) => {
			const annual = fields.interval === "year"
			const mrrMinor =
				fields.mrrMinor ??
				(annual ? Math.round((fields.plan.priceMinor * 10) / 12) : fields.plan.priceMinor)
			subs.push({
				externalId: `sub_${pad(index + 1, 4)}_${++subSeq}`,
				interval: "month",
				end: null,
				status: "active",
				trialEndsAt: null,
				cancelAtPeriodEnd: false,
				cancellationReason: null,
				lastIssue: null,
				failure: null,
				...fields,
				mrrMinor,
			})
		}
		const enterpriseMrr = () => rng.int(50, 240) * 5_000
		const mrrFor = (plan: Plan) => (plan === ENTERPRISE ? enterpriseMrr() : undefined)
		/** A live monthly subscription whose latest invoice was issued `lastIssueAgo` days ago. */
		const anchoredStart = (lastIssueAgo: number, months: number) =>
			addMonths(dayAt(clock, lastIssueAgo), -months)

		const plan = archetype === "lead" ? null : pickPlan(rng, archetype)
		let createdAgo = 0
		let intensity = (_ago: number) => 1
		let contacts = contactCount(rng, plan)
		/** Contact tweaks applied once contacts exist. */
		let tweakContacts = (_contacts: Array<ContactSpec>) => {}

		// Only a lead has no plan.
		if (plan === null) {
			createdAgo = rng.int(5, 300)
			const silent = rng.chance(0.4)
			tweakContacts = (list) =>
				list.forEach((contact, i) => (contact.weekdayP = silent ? 0 : i === 0 ? 0.55 : 0.15))
		} else {
			switch (archetype) {
				case "trial_healthy":
				case "trial_ending_low": {
					const endsIn = archetype === "trial_healthy" ? rng.int(7, 13) : rng.int(1, 4)
					const trialEnd = dayAt(clock, -endsIn) + rng.int(8, 18) * 3_600_000
					const trialStartAgo = 14 - endsIn
					createdAgo = trialStartAgo
					sub({
						plan,
						start: dayAt(clock, trialStartAgo),
						status: "trialing",
						trialEndsAt: trialEnd,
						mrrMinor: 0,
					})
					if (archetype === "trial_healthy") {
						contacts = rng.int(3, 6)
						tweakContacts = (list) =>
							list.forEach((contact, i) => {
								contact.weekdayP = i === 0 ? 0.95 : rng.between(0.5, 0.75)
								contact.forced.add(contact.joinAgo)
							})
					} else {
						contacts = rng.int(2, 4)
						// Only the admin shows up in the last week; the others tried it once, early.
						tweakContacts = (list) =>
							list.forEach((contact, i) => {
								contact.weekdayP = i === 0 ? 0.3 : 0.25
								if (i > 0) contact.stopAgo = 8
							})
					}
					break
				}
				case "onboarding_stalled": {
					createdAgo = rng.int(8, 28)
					contacts = rng.int(2, 4)
					sub({ plan, start: dayAt(clock, createdAgo) })
					const championStop = rng.int(0, createdAgo - 2)
					tweakContacts = (list) =>
						list.forEach((contact, i) => {
							contact.weekdayP = i === 0 ? 0.5 : 0
							if (i === 0) contact.stopAgo = championStop
						})
					break
				}
				case "churned": {
					const cancelAgo = rng.int(30, 300)
					const startAgo = Math.min(364, cancelAgo + rng.int(45, 240))
					createdAgo = startAgo + rng.int(0, 21)
					sub({
						plan,
						start: dayAt(clock, startAgo),
						end: dayAt(clock, cancelAgo) + rng.int(9, 17) * 3_600_000,
						status: "canceled",
						cancellationReason: rng.pick(CHURN_REASONS),
					})
					const stopAgo = cancelAgo + rng.int(0, 7)
					intensity = (ago) => (ago > cancelAgo + 45 ? 1 : 0.3 + (0.7 * (ago - cancelAgo)) / 45)
					tweakContacts = (list) =>
						list.forEach((contact) => (contact.stopAgo = Math.max(contact.stopAgo, stopAgo)))
					break
				}
				case "payment_failed": {
					const overdue = rng.int(8, 40)
					const unpaid = overdue >= 30
					const months = rng.int(2, 9)
					const start = anchoredStart(overdue, months)
					createdAgo = Math.round((clock.today - start) / DAY_MS) + rng.int(0, 21)
					sub({
						plan,
						start,
						status: unpaid ? "unpaid" : "past_due",
						lastIssue: addMonths(start, months),
						failure: { attempts: rng.int(2, 4), declineReason: rng.pick(DECLINE_REASONS) },
					})
					break
				}
				case "cancel_scheduled": {
					const endsIn = rng.int(3, 20)
					const start = anchoredStart(-endsIn, rng.int(3, 10))
					createdAgo = Math.round((clock.today - start) / DAY_MS) + rng.int(0, 21)
					sub({
						plan,
						start,
						cancelAtPeriodEnd: true,
						cancellationReason: rng.pick(CHURN_REASONS),
					})
					break
				}
				case "downgraded":
				case "healthy_growing": {
					// downgraded: from the tier above, 2–12 days ago; growing: up from the tier below.
					const changeAgo = archetype === "downgraded" ? rng.int(2, 12) : rng.int(20, 200)
					const startAgo = Math.min(364, changeAgo + rng.int(45, 300))
					createdAgo = startAgo + rng.int(0, 21)
					const before = archetype === "downgraded" ? tierAbove(plan) : tierBelow(plan)
					const change = dayAt(clock, changeAgo) + rng.int(9, 17) * 3_600_000
					sub({
						plan: before,
						mrrMinor: mrrFor(before),
						start: dayAt(clock, startAgo),
						end: change,
						status: "canceled",
					})
					const annual = plan === ENTERPRISE ? rng.chance(0.8) : rng.chance(0.25)
					sub({
						plan,
						mrrMinor: mrrFor(plan),
						start: change,
						interval: annual ? "year" : "month",
					})
					if (archetype === "healthy_growing")
						intensity = (ago) => 0.7 + 0.3 * Math.max(0, 1 - ago / 120)
					break
				}
				default: {
					// healthy_stable, went_quiet, usage_drop, champion_left, near_limit, seat_growth
					const startAgo = rng.int(archetype === "healthy_stable" ? 30 : 75, 364)
					createdAgo = startAgo + rng.int(0, 21)
					const annual =
						archetype === "healthy_stable" &&
						(plan === ENTERPRISE ? rng.chance(0.8) : rng.chance(0.2))
					sub({
						plan,
						mrrMinor: mrrFor(plan),
						start: dayAt(clock, startAgo),
						interval: annual ? "year" : "month",
					})
					if (archetype === "went_quiet") {
						const quietAgo = rng.int(15, 45)
						contacts = Math.max(contacts, 4)
						tweakContacts = (list) =>
							list.forEach((contact, i) => {
								contact.stopAgo = quietAgo
								if (i < 3) contact.weekdayP = Math.max(contact.weekdayP, 0.5)
								if (i < 3) contact.forced.add(quietAgo)
							})
					}
					if (archetype === "usage_drop") {
						contacts = Math.max(contacts, rng.int(6, 10))
						// The last week: only a couple of visits, so the 7-day average falls well past -50%.
						intensity = (ago) => (ago < 7 ? 0 : 1)
						tweakContacts = (list) => {
							list[0].forced.add(rng.int(0, 2)).add(rng.int(3, 6))
							list[1].forced.add(rng.int(1, 6))
						}
					}
					if (archetype === "champion_left") {
						const championStop = rng.int(15, 19)
						contacts = Math.max(contacts, 4)
						// Daily through the 11 days before leaving, so they stay the 30-day champion.
						tweakContacts = (list) =>
							list.forEach((contact, i) => {
								contact.weekdayP = i === 0 ? 1 : 0.12
								if (i === 1) contact.forced.add(rng.int(1, 6))
								if (i > 0) return
								contact.stopAgo = championStop
								for (let ago = championStop; ago <= championStop + 10; ago++)
									contact.forced.add(ago)
							})
					}
					if (archetype === "seat_growth") {
						contacts = rng.int(4, 6)
						const newcomers = contacts + rng.int(1, 4)
						tweakContacts = (list) => {
							for (const contact of list) {
								contact.weekdayP = Math.max(contact.weekdayP, 0.4)
								contact.forced.add(40)
							}
							for (let i = 0; i < newcomers; i++)
								list.push(newContact(rng.int(3, 28), rng.between(0.35, 0.6)))
							for (const contact of list.slice(contacts)) contact.forced.add(contact.joinAgo)
						}
					}
				}
			}
		}

		const newContact = (joinAgo: number, weekdayP: number): ContactSpec => {
			const first = rng.pick(FIRST_NAMES)
			const last = rng.pick(LAST_NAMES)
			let email = `${first}.${last}@${domain}`.toLowerCase()
			for (let n = 2; emails.has(email); n++) email = `${first}.${last}${n}@${domain}`.toLowerCase()
			emails.add(email)
			return {
				externalId: `user_${pad(++contactSeq, 5)}`,
				name: `${first} ${last}`,
				email,
				role: "org:member",
				isBillingContact: false,
				joinAgo,
				stopAgo: 0,
				removedAgo: null,
				weekdayP,
				forced: new Set(),
			}
		}

		const contactList = Array.from({ length: contacts }, (_, i) => {
			if (i === 0)
				return { ...newContact(createdAgo, 0.9), role: "org:admin" as const, isBillingContact: true }
			const spread = archetype === "healthy_growing" ? rng.next() * 0.9 : rng.next() * 0.4
			const joinAgo = Math.max(0, createdAgo - Math.floor(createdAgo * spread))
			const weekdayP = i <= 2 ? rng.between(0.4, 0.55) : rng.chance(0.1) ? 0 : rng.between(0.08, 0.25)
			const contact = newContact(joinAgo, weekdayP)
			return i === 1 && contacts >= 4 && rng.chance(0.5)
				? { ...contact, role: "org:admin" as const }
				: contact
		})
		tweakContacts(contactList)

		return {
			index,
			clerkOrgId,
			name,
			domain,
			archetype,
			createdAgo,
			contacts: contactList,
			subs,
			intensity,
			usageShare: archetype === "near_limit" ? rng.between(0.55, 0.7) : rng.between(0.2, 0.45),
			stripeSameAs: true,
		}
	})
}

/** The few deliberate data-quality cases: removed members, domain-only Stripe links, a shared domain. */
const addEdgeCases = (rng: Rng, accounts: Array<AccountSpec>) => {
	const stable = accounts.filter((account) => account.archetype === "healthy_stable")
	const leavers = stable
		.flatMap((account) =>
			account.contacts.filter((contact, i) => i > 0 && contact.joinAgo > 90).slice(0, 1),
		)
		.slice(0, 2)
	for (const leaver of leavers) {
		leaver.removedAgo = rng.int(20, 60)
		leaver.stopAgo = leaver.removedAgo + 1
	}
	for (const account of stable.slice(-2)) account.stripeSameAs = false
}

// ---------------------------------------------------------------------------------------------
// Activity

interface ActiveDay {
	readonly ago: number
	readonly eventCount: number
	readonly sessionCount: number
}

const simulateActivity = (rng: Rng, clock: Clock, account: AccountSpec, contact: ContactSpec) => {
	const days: Array<ActiveDay> = []
	for (let ago = contact.joinAgo; ago >= contact.stopAgo; ago--) {
		const p = contact.weekdayP * (isWeekend(dayAt(clock, ago)) ? 0.3 : 1) * account.intensity(ago)
		if (!contact.forced.has(ago) && !rng.chance(p)) continue
		days.push({
			ago,
			eventCount: Math.min(
				400,
				Math.max(5, Math.round(contact.weekdayP * 220 * rng.between(0.3, 1.7))),
			),
			sessionCount: Math.min(8, 1 + Math.floor(rng.next() * (1 + contact.weekdayP * 6))),
		})
	}
	return days
}

// ---------------------------------------------------------------------------------------------
// Ops

const clerkRef = (externalId: string): ProviderRef => ({ provider: "clerk", externalId })
const CLERK_DASHBOARD = "https://dashboard.clerk.com/apps/app_demo/instances/ins_demo"

const clerkOps = (
	rng: Rng,
	clock: Clock,
	account: AccountSpec,
	activity: ReadonlyMap<ContactSpec, ReadonlyArray<ActiveDay>>,
): Array<IngestOp> => [
	{
		_tag: "account",
		externalId: account.clerkOrgId,
		externalUrl: `${CLERK_DASHBOARD}/organizations/${account.clerkOrgId}`,
		name: account.name,
		domains: [account.domain],
		logoUrl: rng.chance(0.15) ? `https://img.clerk.com/demo/${account.clerkOrgId}.png` : null,
		createdAt: stamp(clock, rng, dayAt(clock, account.createdAgo)),
		sameAs: [],
		onNoMatch: "create",
	},
	...account.contacts.map((contact): IngestOp => {
		const days = activity.get(contact) ?? []
		const last = days[days.length - 1]
		const lastSignInAt = last === undefined ? null : stamp(clock, rng, dayAt(clock, last.ago))
		const lastSeenAt =
			lastSignInAt === null
				? null
				: iso(Math.min(Date.parse(lastSignInAt) + rng.int(5, 180) * 60_000, clock.now))
		const op: UpsertContact = {
			_tag: "contact",
			externalId: contact.externalId,
			account: clerkRef(account.clerkOrgId),
			externalUrl: `${CLERK_DASHBOARD}/users/${contact.externalId}`,
			email: contact.email,
			name: contact.name,
			role: contact.role,
			isBillingContact: contact.isBillingContact,
			joinedAt: stamp(clock, rng, dayAt(clock, contact.joinAgo)),
			lastSignInAt,
			lastSeenAt,
			signInCount30d: days.filter((day) => day.ago < 30).length,
		}
		return contact.removedAgo === null ? op : { ...op, removed: true }
	}),
]

/** Days of daily api_calls history (enough for near_limit and a usage chart). */
const API_CALL_DAYS = 60

const METRIC_DEFINITIONS: ReadonlyArray<IngestOp> = [
	{
		_tag: "metric_definition",
		key: "api_calls",
		name: "API calls",
		unit: "calls",
		aggregation: "sum",
		description: "API requests per day",
	},
	{
		_tag: "metric_definition",
		key: "projects",
		name: "Projects",
		unit: "projects",
		aggregation: "last",
		description: "Projects in the workspace",
	},
	{
		_tag: "metric_definition",
		key: "storage_gb",
		name: "Storage",
		unit: "GB",
		aggregation: "max",
		description: "Stored data",
	},
]

/** Invoice issue dates of a subscription: every month (or year) from its start while billed. */
const issueDates = (clock: Clock, sub: SubSpec) => {
	if (sub.status === "trialing") return []
	const step = sub.interval === "year" ? 12 : 1
	const until = Math.min(clock.now, sub.end === null ? Infinity : sub.end - 1, sub.lastIssue ?? Infinity)
	const dates: Array<number> = []
	for (let k = 0; addMonths(sub.start, k * step) <= until; k++) dates.push(addMonths(sub.start, k * step))
	return dates
}

const periodEnd = (clock: Clock, sub: SubSpec) => {
	if (sub.trialEndsAt !== null) return sub.trialEndsAt
	const step = sub.interval === "year" ? 12 : 1
	let k = 1
	while (addMonths(sub.start, k * step) <= (sub.lastIssue ?? clock.now)) k++
	return addMonths(sub.start, k * step)
}

const autumnOps = (
	rng: Rng,
	clock: Clock,
	activityDays: number,
	account: AccountSpec,
	activeByAgo: ReadonlyArray<number>,
): Array<IngestOp> => {
	const ref: ProviderRef = { provider: "autumn", externalId: account.clerkOrgId }
	const live = account.subs.find((sub) => sub.end === null)
	const seatsUsed = account.contacts.filter((contact) => contact.removedAgo === null).length
	const accountOp: UpsertAccount = {
		_tag: "account",
		externalId: account.clerkOrgId,
		name: account.name,
		sameAs: [clerkRef(account.clerkOrgId)],
		onNoMatch: "unmatched",
	}
	const ops: Array<IngestOp> = [
		live === undefined
			? accountOp
			: {
					...accountOp,
					seatsUsed,
					seatsLimit: live.plan === ENTERPRISE ? Math.max(25, seatsUsed + 5) : live.plan.seats,
				},
	]

	const card = () => {
		const expiringSoon = rng.chance(0.06)
		const today = new Date(clock.today)
		return {
			brand: "visa",
			last4: pad(rng.int(0, 9999), 4),
			expMonth: expiringSoon ? today.getUTCMonth() + 1 : rng.int(1, 12),
			expYear: today.getUTCFullYear() + (expiringSoon ? 0 : rng.int(1, 4)),
		}
	}
	for (const sub of account.subs) {
		const trial = sub.status === "trialing"
		const lastMonth = new Date(addMonths(clock.today, -1))
		ops.push({
			_tag: "subscription",
			externalId: sub.externalId,
			account: ref,
			planName: sub.plan.name,
			status: sub.status,
			mrrMinor: sub.mrrMinor,
			listMrrMinor: trial
				? sub.plan.priceMinor
				: sub.plan === ENTERPRISE
					? sub.mrrMinor
					: sub.plan.priceMinor,
			currency: "usd",
			interval: sub.interval,
			quantity: 1,
			startedAt: iso(sub.start),
			trialEndsAt: sub.trialEndsAt === null ? null : iso(sub.trialEndsAt),
			currentPeriodEnd: sub.end === null ? iso(periodEnd(clock, sub)) : null,
			cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
			canceledAt: sub.end === null ? null : iso(sub.end),
			cancellationReason: sub.cancellationReason,
			paymentMethod: trial
				? null
				: sub.failure?.declineReason === "expired_card"
					? {
							brand: "visa",
							last4: pad(rng.int(0, 9999), 4),
							expMonth: lastMonth.getUTCMonth() + 1,
							expYear: lastMonth.getUTCFullYear(),
						}
					: card(),
		})
	}

	// Metered usage while a subscription was live: api_calls daily over the last API_CALL_DAYS days,
	// tracking the account's activity; projects and storage weekly (every 7th day back from today).
	const planOn = (dayMs: number) =>
		account.subs.find((sub) => sub.start <= dayMs + DAY_MS - 1 && (sub.end === null || sub.end > dayMs))
			?.plan
	const liveDays = Array.from({ length: activityDays }, (_, i) => activityDays - 1 - i).flatMap((ago) => {
		const plan = planOn(dayAt(clock, ago))
		return plan === undefined ? [] : [{ ago, plan }]
	})
	const meanActive = Math.max(
		0.5,
		liveDays.reduce((sum, { ago }) => sum + activeByAgo[ago], 0) / Math.max(1, liveDays.length),
	)
	const projectShare = rng.between(0.3, 0.7)
	const storageShare = rng.between(0.1, 0.6)
	let peak = { ago: -1, ratio: 0, limit: 0, value: 0, plan: STARTER }
	for (const { ago, plan } of liveDays) {
		const day = dayKey(dayAt(clock, ago))
		const progress = 1 - ago / Math.max(1, activityDays - 1)
		const limit = plan.apiCallsPerDay
		const usage =
			account.usageShare *
			(0.1 + 0.9 * Math.min(2, activeByAgo[ago] / meanActive)) *
			rng.between(0.9, 1.1)
		const share =
			account.archetype === "near_limit" && ago < 7
				? rng.between(0.92, 1.3)
				: Math.min(usage, account.archetype === "near_limit" ? 0.85 : 0.7)
		const apiCalls = Math.round(limit * share)
		if (account.archetype === "near_limit" && ago < 7 && share > peak.ratio)
			peak = { ago, ratio: share, limit, value: apiCalls, plan }
		if (ago < API_CALL_DAYS) {
			ops.push({
				_tag: "metric",
				account: ref,
				metricKey: "api_calls",
				day,
				value: apiCalls,
				limitValue: limit,
			})
		}
		if (ago % 7 !== 0) continue
		const projectBase = plan.projects ?? 40
		ops.push(
			{
				_tag: "metric",
				account: ref,
				metricKey: "projects",
				day,
				value: Math.max(1, Math.round(projectBase * projectShare * (0.6 + 0.4 * progress))),
				limitValue: plan.projects,
			},
			{
				_tag: "metric",
				account: ref,
				metricKey: "storage_gb",
				day,
				value: Math.round(plan.storageGb * storageShare * (0.5 + 0.5 * progress) * 10) / 10,
				limitValue: plan.storageGb,
			},
		)
	}
	if (peak.ago >= 0) {
		const pct = Math.round(peak.ratio * 100)
		ops.push({
			_tag: "event",
			externalId: `evt_${account.clerkOrgId}_api_calls_${dayKey(dayAt(clock, peak.ago))}`,
			account: ref,
			type: peak.ratio >= 1 ? "usage.limit_reached" : "usage.limit_approaching",
			title: `API calls at ${pct}% of the ${peak.plan.name} plan limit`,
			data: { metricKey: "api_calls", value: peak.value, limit: peak.limit },
			occurredAt: stamp(clock, rng, dayAt(clock, peak.ago)),
		})
	}
	return ops
}

interface InvoiceCounter {
	next: number
}

const invoiceOp = (
	counter: InvoiceCounter,
	customer: ProviderRef,
	fields: Omit<
		Extract<IngestOp, { _tag: "invoice" }>,
		"_tag" | "externalId" | "account" | "number" | "currency" | "hostedUrl"
	> & { readonly externalId?: string },
): IngestOp => {
	const n = counter.next++
	const externalId = fields.externalId ?? `in_${pad(n, 5)}`
	return {
		_tag: "invoice",
		externalId,
		account: customer,
		number: `INV-${pad(n, 4)}`,
		currency: "usd",
		hostedUrl: `https://invoice.stripe.com/i/acct_demo/${externalId}`,
		...fields,
	}
}

const stripeCustomerOp = (
	clock: Clock,
	rng: Rng,
	externalId: string,
	name: string,
	domain: string,
	sameAs: ReadonlyArray<ProviderRef>,
	createdAgo: number,
): IngestOp => ({
	_tag: "account",
	externalId,
	externalUrl: `https://dashboard.stripe.com/customers/${externalId}`,
	name,
	domains: [domain],
	createdAt: stamp(clock, rng, dayAt(clock, createdAgo)),
	sameAs,
	matchByDomain: true,
	onNoMatch: "unmatched",
})

const stripeOps = (
	rng: Rng,
	clock: Clock,
	account: AccountSpec,
	counter: InvoiceCounter,
	upcomingFor: ReadonlySet<string>,
): Array<IngestOp> => {
	const customerId = `cus_${pad(account.index + 1, 4)}`
	const customer: ProviderRef = { provider: "stripe", externalId: customerId }
	const sameAs = account.stripeSameAs ? [clerkRef(account.clerkOrgId)] : []
	const ops: Array<IngestOp> = [
		stripeCustomerOp(clock, rng, customerId, account.name, account.domain, sameAs, account.createdAgo),
	]
	for (const sub of account.subs) {
		const dates = issueDates(clock, sub)
		for (const [i, issued] of dates.entries()) {
			const amount = sub.interval === "year" ? sub.mrrMinor * 12 : sub.mrrMinor
			const dueAt = sub.interval === "year" || sub.plan === ENTERPRISE ? issued + 7 * DAY_MS : issued
			const issuedAt = issued + rng.int(1, 6) * 3_600_000
			if (sub.failure !== null && i === dates.length - 1) {
				ops.push(
					invoiceOp(counter, customer, {
						subscriptionExternalId: sub.externalId,
						status: "open",
						amountDueMinor: amount,
						amountPaidMinor: 0,
						issuedAt: iso(Math.min(issuedAt, clock.now)),
						dueAt: iso(dueAt),
						paidAt: null,
						attemptCount: sub.failure.attempts,
						nextRetryAt:
							sub.status === "unpaid"
								? null
								: iso(dayAt(clock, -rng.int(1, 4)) + 10 * 3_600_000),
						declineReason: sub.failure.declineReason,
					}),
				)
				continue
			}
			ops.push(
				invoiceOp(counter, customer, {
					subscriptionExternalId: sub.externalId,
					status: "paid",
					amountDueMinor: amount,
					amountPaidMinor: amount,
					issuedAt: iso(Math.min(issuedAt, clock.now)),
					dueAt: iso(dueAt),
					paidAt: iso(
						Math.min(issuedAt + rng.int(0, 2) * DAY_MS + rng.int(1, 60) * 60_000, clock.now),
					),
					attemptCount: 1,
				}),
			)
		}
		if (upcomingFor.has(sub.externalId)) {
			const issued = periodEnd(clock, sub)
			ops.push(
				invoiceOp(counter, customer, {
					externalId: `upcoming:${sub.externalId}`,
					subscriptionExternalId: sub.externalId,
					status: "upcoming",
					amountDueMinor: sub.interval === "year" ? sub.mrrMinor * 12 : sub.mrrMinor,
					amountPaidMinor: 0,
					issuedAt: iso(issued),
					dueAt: iso(issued),
					paidAt: null,
					attemptCount: 0,
				}),
			)
		}
	}
	return ops
}

/** Stripe customers with no `metadata.clerk_org_id`: no domain match, or a domain two accounts share. */
const unmatchedStripeOps = (
	rng: Rng,
	clock: Clock,
	counter: InvoiceCounter,
	strangers: ReadonlyArray<{ readonly name: string; readonly domain: string }>,
): Array<IngestOp> =>
	strangers.flatMap(({ name, domain }, i) => {
		const customer: ProviderRef = { provider: "stripe", externalId: `cus_x${pad(i + 1, 3)}` }
		const months = rng.int(1, 4)
		const amount = rng.pick([STARTER, TEAM]).priceMinor
		const firstAgo = months * 30 + rng.int(0, 20)
		return [
			stripeCustomerOp(clock, rng, customer.externalId, name, domain, [], firstAgo),
			...Array.from({ length: months }, (_, k) => {
				const issued = addMonths(dayAt(clock, firstAgo), k) + rng.int(1, 6) * 3_600_000
				return invoiceOp(counter, customer, {
					subscriptionExternalId: null,
					status: "paid",
					amountDueMinor: amount,
					amountPaidMinor: amount,
					issuedAt: iso(issued),
					dueAt: iso(issued),
					paidAt: iso(Math.min(issued + rng.int(1, 120) * 60_000, clock.now)),
					attemptCount: 1,
				})
			}),
		]
	})

const mapleOps = (
	clock: Clock,
	account: AccountSpec,
	activity: ReadonlyMap<ContactSpec, ReadonlyArray<ActiveDay>>,
	activityDays: number,
): Array<IngestOp> =>
	account.contacts.flatMap((contact) =>
		(activity.get(contact) ?? [])
			.filter((day) => day.ago < activityDays)
			.map((day): IngestOp => ({
				_tag: "activity",
				contact: clerkRef(contact.externalId),
				account: clerkRef(account.clerkOrgId),
				day: dayKey(dayAt(clock, day.ago)),
				eventCount: day.eventCount,
				sessionCount: day.sessionCount,
				signedIn: true,
			})),
	)

// ---------------------------------------------------------------------------------------------

export const generateDemoSeed = (options: DemoSeedOptions): DemoSeed => {
	const total = options.accounts ?? 200
	const activityDays = options.activityDays ?? 120
	const rng = makeRng(options.seed ?? 1)
	const now = options.now.getTime()
	const clock: Clock = { now, today: now - (now % DAY_MS) }

	const archetypes = shuffle(rng, archetypeCounts(total))
	const names = companyNames(rng, total + 3)
	// Two lead organizations of one company share a domain (a Stripe customer on it is ambiguous).
	const [firstLead, secondLead] = archetypes.flatMap((archetype, i) => (archetype === "lead" ? [i] : []))
	const shared = firstLead === undefined || secondLead === undefined ? null : names[firstLead]
	if (shared !== null && secondLead !== undefined)
		names[secondLead] = { name: `${shared.name} EU`, domain: shared.domain }

	const accounts = planAccounts(rng, clock, archetypes, names)
	addEdgeCases(rng, accounts)

	const activity = new Map<ContactSpec, ReadonlyArray<ActiveDay>>()
	for (const account of accounts) {
		for (const contact of account.contacts)
			activity.set(contact, simulateActivity(rng, clock, account, contact))
	}
	const activeByAgo = (account: AccountSpec) => {
		const counts = Array.from({ length: activityDays }, () => 0)
		for (const contact of account.contacts) {
			for (const day of activity.get(contact) ?? []) if (day.ago < activityDays) counts[day.ago]++
		}
		return counts
	}

	const billed = accounts.filter((account) => account.subs.length > 0)
	const upcomingFor = new Set(
		billed
			.filter(
				(account) =>
					account.archetype === "healthy_stable" || account.archetype === "healthy_growing",
			)
			.flatMap((account) => account.subs.filter((sub) => sub.end === null))
			.sort((a, b) => b.mrrMinor - a.mrrMinor || a.externalId.localeCompare(b.externalId))
			.slice(0, 2)
			.map((sub) => sub.externalId),
	)
	const counter: InvoiceCounter = { next: 1 }
	const strangers = [
		...names.slice(total),
		...(shared === null ? [] : [{ name: `${shared.name} Holdings`, domain: shared.domain }]),
	]

	return {
		batches: [
			{
				provider: "clerk",
				ops: accounts.flatMap((account) => clerkOps(rng, clock, account, activity)),
			},
			{
				provider: "autumn",
				ops: [
					...METRIC_DEFINITIONS,
					...billed.flatMap((account) =>
						autumnOps(rng, clock, activityDays, account, activeByAgo(account)),
					),
				],
			},
			{
				provider: "stripe",
				ops: [
					...billed.flatMap((account) => stripeOps(rng, clock, account, counter, upcomingFor)),
					...unmatchedStripeOps(rng, clock, counter, strangers),
				],
			},
			{
				provider: "maple",
				ops: accounts.flatMap((account) => mapleOps(clock, account, activity, activityDays)),
			},
		],
		accounts: accounts.map(({ clerkOrgId, name, archetype }) => ({ clerkOrgId, name, archetype })),
	}
}
