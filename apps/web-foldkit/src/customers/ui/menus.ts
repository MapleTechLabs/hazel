import type { Html, HtmlBuilder } from "foldkit/html"
import * as Menu from "../../ui/menu"
import { menuKeyboard, menuLabel } from "../../ui/menu-view"
import { formatWeekdayTime, type Instant } from "../format"

/**
 * The queue's menus (Foundations › Menus Snooze And Row Actions) for the app's `ui/menu` Submodel:
 * the page builds its `entries` from these keys, `content` renders each key (`viewInputs.content`). The page keeps the `Menu.Model` and maps `Menu.OutMessage.SelectedItem`
 * keys to its own Messages; `snoozeUntil` turns a snooze key into the instant.
 */

// SNOOZE

export const SNOOZE_KEYS = ["tomorrow", "in_3_days", "next_week"] as const
export type SnoozeKey = (typeof SNOOZE_KEYS)[number]
export const PICK_DATE_KEY = "pick_date"

const SNOOZE_LABEL = {
	tomorrow: "Tomorrow",
	in_3_days: "In 3 days",
	next_week: "Next week",
} as const satisfies Record<SnoozeKey, string>

/** 9:00 local on the snooze day: tomorrow, in 3 days, or next Monday. */
export const snoozeUntil = (key: SnoozeKey, now: Date): Date => {
	const at = new Date(now)
	at.setHours(9, 0, 0, 0)
	const days = key === "tomorrow" ? 1 : key === "in_3_days" ? 3 : (8 - now.getDay()) % 7 || 7
	at.setDate(at.getDate() + days)
	return at
}

export const isSnoozeKey = (key: string): key is SnoozeKey =>
	(SNOOZE_KEYS as ReadonlyArray<string>).includes(key)

/** Snooze menu item content (`SNOOZE_KEYS` and `PICK_DATE_KEY`), with each option's wake time. */
export const snoozeMenuContent =
	<M>(h: HtmlBuilder<M>, menuId: string, now: Date, options: Readonly<{ timeZone?: string }> = {}) =>
	(key: string): ReadonlyArray<Html | string> =>
		isSnoozeKey(key)
			? [
					// The time sits in the label's cell, not the kit's absolute key-hint spot: the menu
					// widens to fit it instead of drawing it over the label.
					h.span(
						[h.Class("col-start-2 flex items-baseline justify-between gap-4")],
						[
							menuLabel(h, menuId, key, SNOOZE_LABEL[key]),
							// The kit's key hint, taken out of its absolute spot.
							menuKeyboard(
								h,
								formatWeekdayTime(snoozeUntil(key, now), options),
								"static pl-0 text-xs",
							),
						],
					),
				]
			: [menuLabel(h, menuId, key, "Pick date…")]

// MUTE (a customer out of Needs attention)

/** Leaf keys of a "Mute in Needs attention" submenu. */
const MUTE_KEYS = ["mute:week", "mute:month", "mute:forever"] as const
export type MuteKey = (typeof MUTE_KEYS)[number]

export const MUTE_LABEL = {
	"mute:week": "For a week",
	"mute:month": "For a month",
	"mute:forever": "Until unmuted",
} as const satisfies Record<MuteKey, string>

export const isMuteKey = (key: string): key is MuteKey => (MUTE_KEYS as ReadonlyArray<string>).includes(key)

export const muteLeaves: ReadonlyArray<Menu.Leaf> = MUTE_KEYS.map((key) =>
	Menu.leaf(key, { textValue: MUTE_LABEL[key] }),
)

/** When the mute ends: 7 or 30 days from now, or never (null). */
export const muteUntil = (key: MuteKey, now: Date): Date | null =>
	key === "mute:forever" ? null : new Date(now.getTime() + (key === "mute:week" ? 7 : 30) * 86_400_000)

// SNOOZE SUBMENU LEAVES

/** Snooze submenu leaves are `snooze:<SnoozeKey>` (and `snooze:pick_date`). */
export const snoozeLeafKey = (key: SnoozeKey | typeof PICK_DATE_KEY) => `snooze:${key}`

/** Reads `snooze:<key>` back. */
export const snoozeKeyOfLeaf = (key: string): SnoozeKey | typeof PICK_DATE_KEY | null => {
	const rest = key.startsWith("snooze:") ? key.slice("snooze:".length) : null
	return rest === null ? null : rest === PICK_DATE_KEY ? PICK_DATE_KEY : isSnoozeKey(rest) ? rest : null
}

/** A key → when the snooze ends, for the page's `SelectedItem` handler (`null` for pick-date or other keys). */
export const snoozeInstantOf = (key: string, now: Date): Instant | null => {
	const snooze = isSnoozeKey(key) ? key : snoozeKeyOfLeaf(key)
	return snooze === null || snooze === PICK_DATE_KEY ? null : snoozeUntil(snooze, now)
}
