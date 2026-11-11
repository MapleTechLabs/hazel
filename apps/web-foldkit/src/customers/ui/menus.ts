import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { dropdownKeyboardBase } from "~/components/ui/dropdown.styles"
import { keyboardStyles } from "~/components/ui/keyboard.styles"
import { IconCheck, IconClock, IconClose, IconCopy, IconExternalLink, IconUser } from "../../icons"
import * as Menu from "../../ui/menu"
import { menuLabel } from "../../ui/menu-view"
import { formatWeekdayTime, type Instant } from "../format"

/**
 * The queue's menus (Foundations › Menus Snooze And Row Actions) for the app's `ui/menu` Submodel:
 * `entries` is the structure (pass it as `viewInputs.entries`), `content` renders each key
 * (`viewInputs.content`). The page keeps the `Menu.Model` and maps `Menu.OutMessage.SelectedItem`
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

/** `Snooze until` · Tomorrow · In 3 days · Next week · ─ · Pick date… */
export const snoozeMenuEntries: ReadonlyArray<Menu.Entry> = [
	Menu.section(
		"Snooze until",
		SNOOZE_KEYS.map((key) => Menu.item(key, { textValue: SNOOZE_LABEL[key] })),
	),
	Menu.separator,
	Menu.item(PICK_DATE_KEY, { textValue: "Pick date" }),
]

/** Right-aligned hint in a menu item (a time, a key). */
const hint = <M>(h: HtmlBuilder<M>, text: string): Html =>
	h.span(
		[
			h.Attribute("data-slot", "keyboard"),
			h.Class(twMerge(keyboardStyles, dropdownKeyboardBase, "font-sans text-xs")),
		],
		[text],
	)

const keyHint = <M>(h: HtmlBuilder<M>, text: string): Html =>
	h.kbd(
		[h.Attribute("data-slot", "keyboard"), h.Class(twMerge(keyboardStyles, dropdownKeyboardBase))],
		[text],
	)

/** Item content for `snoozeMenuEntries`, with each option's wake time. */
export const snoozeMenuContent =
	<M>(h: HtmlBuilder<M>, menuId: string, now: Date, options: Readonly<{ timeZone?: string }> = {}) =>
	(key: string): ReadonlyArray<Html | string> =>
		isSnoozeKey(key)
			? [
					menuLabel(h, menuId, key, SNOOZE_LABEL[key]),
					hint(h, formatWeekdayTime(snoozeUntil(key, now), options)),
				]
			: [menuLabel(h, menuId, key, "Pick date…")]

// ROW ACTIONS

export const ROW_ACTION_KEYS = ["assign", "snooze", "done", "dismiss", "open", "copy_email"] as const
export type RowActionKey = (typeof ROW_ACTION_KEYS)[number]

/** The submenu's leaves are `snooze:<SnoozeKey>` (and `snooze:pick_date`). */
export const snoozeLeafKey = (key: SnoozeKey | typeof PICK_DATE_KEY) => `snooze:${key}`

/** Reads `snooze:<key>` back. */
export const snoozeKeyOfLeaf = (key: string): SnoozeKey | typeof PICK_DATE_KEY | null => {
	const rest = key.startsWith("snooze:") ? key.slice("snooze:".length) : null
	return rest === null ? null : rest === PICK_DATE_KEY ? PICK_DATE_KEY : isSnoozeKey(rest) ? rest : null
}

/** Assign · Snooze ▸ · Mark done · Dismiss · ─ · Open customer · Copy champion's email (when there is one). */
export const rowActionsEntries = (
	options: Readonly<{ championEmail: boolean }>,
): ReadonlyArray<Menu.Entry> => [
	Menu.item("assign", { textValue: "Assign" }),
	Menu.item("snooze", {
		textValue: "Snooze",
		submenu: [
			...SNOOZE_KEYS.map((key) => Menu.leaf(snoozeLeafKey(key), { textValue: SNOOZE_LABEL[key] })),
			Menu.leaf(snoozeLeafKey(PICK_DATE_KEY), { textValue: "Pick date" }),
		],
	}),
	Menu.item("done", { textValue: "Mark done" }),
	Menu.item("dismiss", { textValue: "Dismiss" }),
	Menu.separator,
	Menu.item("open", { textValue: "Open customer" }),
	...(options.championEmail ? [Menu.item("copy_email", { textValue: "Copy champion's email" })] : []),
]

/** A row action's menu line: label, key hint (`null`: none) and icon. */
type RowAction = Readonly<{ label: string; key: string | null; icon: <M>(h: HtmlBuilder<M>) => Html }>

const ROW_ACTION = {
	assign: { label: "Assign…", key: "A", icon: (h) => IconUser(h) },
	snooze: { label: "Snooze", key: "S", icon: (h) => IconClock(h) },
	done: { label: "Mark done…", key: "D", icon: (h) => IconCheck(h) },
	dismiss: { label: "Dismiss, not useful", key: null, icon: (h) => IconClose(h) },
	open: { label: "Open customer", key: "Enter", icon: (h) => IconExternalLink(h) },
	copy_email: { label: "Copy champion’s email", key: null, icon: (h) => IconCopy(h) },
} satisfies Record<RowActionKey, RowAction>

const isRowActionKey = (key: string): key is RowActionKey =>
	(ROW_ACTION_KEYS as ReadonlyArray<string>).includes(key)

/** Item content for `rowActionsEntries`, with the queue's key hints and the snooze submenu's times. */
export const rowActionsContent =
	<M>(h: HtmlBuilder<M>, menuId: string, now: Date, options: Readonly<{ timeZone?: string }> = {}) =>
	(key: string): ReadonlyArray<Html | string> => {
		if (isRowActionKey(key)) {
			const action = ROW_ACTION[key]
			return [
				action.icon(h),
				menuLabel(h, menuId, key, action.label),
				// The snooze item's chevron sits where a key hint would.
				...(action.key && key !== "snooze" ? [keyHint(h, action.key)] : []),
			]
		}
		const snooze = snoozeKeyOfLeaf(key)
		return snooze === null ? [key] : snoozeMenuContent(h, menuId, now, options)(snooze)
	}

/** A key → when the snooze ends, for the page's `SelectedItem` handler (`null` for pick-date or other keys). */
export const snoozeInstantOf = (key: string, now: Date): Instant | null => {
	const snooze = isSnoozeKey(key) ? key : snoozeKeyOfLeaf(key)
	return snooze === null || snooze === PICK_DATE_KEY ? null : snoozeUntil(snooze, now)
}
