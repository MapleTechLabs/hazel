/**
 * The queue's menus as data (today's `web-foldkit/src/customers/ui/menus.ts` and the attention page's
 * entries): assign, snooze (with mute), filter and sort. A selected entry's id comes back to the page.
 */
import * as Customers from "@hazel/domain/customers"
import { TEMPLATES } from "@hazel/domain/customers"
import type { UserId } from "@hazel/schema"
import type { Content } from "@hazel/ui/vocabulary/index"
import { formatWeekdayTime } from "../data/format"
import type { MemberRow, SignalRow } from "../data/queries"
import { KIND_LABEL, SEVERITY_LABEL } from "../ui/badges"
import { type Filters, isFilterActive, OWNER_LABEL, OwnerFilter, Sort, SORT_LABEL } from "./model"

// SNOOZE

export const SNOOZE_KEYS = ["tomorrow", "in_3_days", "next_week"] as const
export type SnoozeKey = (typeof SNOOZE_KEYS)[number]
export const PICK_DATE_KEY = "pick_date"
/** A failed payment's next retry. */
export const NEXT_RETRY = "next_retry"
export type SnoozeOption = SnoozeKey | typeof NEXT_RETRY

const SNOOZE_LABEL = {
	tomorrow: "Tomorrow",
	in_3_days: "In 3 days",
	next_week: "Next week",
} as const satisfies Record<SnoozeKey, string>

export const isSnoozeKey = (key: string): key is SnoozeKey =>
	(SNOOZE_KEYS as ReadonlyArray<string>).includes(key)

export const isSnoozeOption = (key: string): key is SnoozeOption => key === NEXT_RETRY || isSnoozeKey(key)

/** 9:00 local on the snooze day: tomorrow, in 3 days, or next Monday. */
export const snoozeUntil = (key: SnoozeKey, now: Date): Date => {
	const at = new Date(now)
	at.setHours(9, 0, 0, 0)
	const days = key === "tomorrow" ? 1 : key === "in_3_days" ? 3 : (8 - now.getDay()) % 7 || 7
	at.setDate(at.getDate() + days)
	return at
}

/** The payment's next retry, when the signal's evidence knows it. */
export const nextRetryMsOf = (signal: SignalRow): number | null =>
	signal.evidence._tag === "amount" && signal.evidence.nextRetryAt !== null
		? Date.parse(signal.evidence.nextRetryAt)
		: null

/** A retry already past snoozes until tomorrow instead. */
export const snoozeUntilMs = (option: SnoozeOption, nowMs: number, signal: SignalRow): number => {
	if (option !== NEXT_RETRY) return snoozeUntil(option, new Date(nowMs)).getTime()
	const retryMs = nextRetryMsOf(signal)
	return retryMs !== null && retryMs > nowMs ? retryMs : snoozeUntil("tomorrow", new Date(nowMs)).getTime()
}

/** A picked day (`YYYY-MM-DD`, local) at 9:00 local; none unless after `nowMs`. */
export const pickedSnoozeMs = (date: string, nowMs: number): number | null => {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
	if (match === null) return null
	const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9).getTime()
	return at > nowMs ? at : null
}

/** `YYYY-MM-DD` of the local day `days` after `nowMs`. */
export const localDateOf = (nowMs: number, days = 0): string => {
	const date = new Date(nowMs)
	date.setDate(date.getDate() + days)
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

// MUTE (a customer out of Needs attention)

export const MUTE_KEYS = ["mute:week", "mute:month", "mute:forever"] as const
export type MuteKey = (typeof MUTE_KEYS)[number]
export const MUTE_CUSTOMER = "mute_customer"

export const MUTE_LABEL = {
	"mute:week": "For a week",
	"mute:month": "For a month",
	"mute:forever": "Until unmuted",
} as const satisfies Record<MuteKey, string>

export const isMuteKey = (key: string): key is MuteKey => (MUTE_KEYS as ReadonlyArray<string>).includes(key)

/** When the mute ends: 7 or 30 days from now, or never (null). */
export const muteUntil = (key: MuteKey, now: Date): Date | null =>
	key === "mute:forever" ? null : new Date(now.getTime() + (key === "mute:week" ? 7 : 30) * 86_400_000)

/**
 * `Snooze until` · Tomorrow · In 3 days · Next week (· After next retry) · Pick date · Mute customer ▸.
 */
export const snoozeEntries = (signal: SignalRow, nowMs: number): Content.MenuGroups => {
	// HAZEL-GAP(pk2-menu-entry-hint): today each snooze option shows its wake time as a muted hint at the row's end; here it follows the label.
	const withTime = (label: string, ms: number) => `${label} · ${formatWeekdayTime(new Date(ms))}`
	return [
		{
			title: "Snooze until",
			entries: [
				...SNOOZE_KEYS.map((key) => ({
					id: key,
					label: withTime(SNOOZE_LABEL[key], snoozeUntil(key, new Date(nowMs)).getTime()),
				})),
				...(nextRetryMsOf(signal) === null
					? []
					: [
							{
								id: NEXT_RETRY,
								label: withTime("After next retry", snoozeUntilMs(NEXT_RETRY, nowMs, signal)),
							},
						]),
			],
		},
		{ entries: [{ id: PICK_DATE_KEY, label: "Pick date..." }] },
		{
			entries: [
				{
					id: MUTE_CUSTOMER,
					label: "Mute customer",
					entries: MUTE_KEYS.map((key) => ({ id: key, label: MUTE_LABEL[key] })),
				},
			],
		},
	]
}

// ASSIGN

export const ASSIGN_ME = "me"
export const ASSIGN_NONE = "none"
const ASSIGN_USER = "user:"
export const assignKeyOf = (userId: UserId) => `${ASSIGN_USER}${userId}`
export const userIdOfAssignKey = (key: string): string | null =>
	key.startsWith(ASSIGN_USER) ? key.slice(ASSIGN_USER.length) : null

/** Assign to me · Team ▸ members · Unassign. */
export const assignEntries = (
	members: ReadonlyArray<MemberRow>,
	userId: UserId | null,
): Content.MenuGroups => [
	// HAZEL-GAP(pk2-menu-entry-hint): today "Assign to me" shows its `I` key cap at the row's end.
	{ entries: [{ id: ASSIGN_ME, label: "Assign to me", icon: "user" }] },
	{
		title: "Team",
		entries: members
			.filter((member) => member.id !== userId)
			.map((member) => ({ id: assignKeyOf(member.id), label: member.name })),
	},
	{ entries: [{ id: ASSIGN_NONE, label: "Unassign" }] },
]

// FILTER AND SORT

/** Filter keys: `<field>:<value>` toggles that filter; the active one is checked. */
export const filterEntries = (filters: Filters, plans: ReadonlyArray<string>): Content.MenuGroups => {
	const entry = (key: string, label: string) => ({ id: key, label, checked: isFilterActive(filters, key) })
	return [
		{
			title: "Owner",
			entries: OwnerFilter.literals.map((owner) => entry(`owner:${owner}`, OWNER_LABEL[owner])),
		},
		{
			title: "Kind",
			entries: Customers.SignalKind.literals.map((kind) => entry(`kind:${kind}`, KIND_LABEL[kind])),
		},
		{
			title: "Severity",
			entries: Customers.SignalSeverity.literals.map((severity) =>
				entry(`severity:${severity}`, SEVERITY_LABEL[severity]),
			),
		},
		{
			title: "Signal type",
			entries: Customers.SignalTemplate.literals.map((template) =>
				entry(`template:${template}`, TEMPLATES[template].name),
			),
		},
		...(plans.length === 0
			? []
			: [{ title: "Plan", entries: plans.map((plan) => entry(`plan:${plan}`, plan)) }]),
	]
}

export const sortEntries = (sort: Sort): Content.MenuGroups => [
	{ entries: Sort.literals.map((key) => ({ id: key, label: SORT_LABEL[key], checked: key === sort })) },
]
