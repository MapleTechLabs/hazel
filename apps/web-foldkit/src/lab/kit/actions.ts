import type { Html, HtmlBuilder } from "foldkit/html"
import { IconBell, IconChevronDown, IconDots, IconDownload, IconPlus, IconStar, IconTrash } from "../../icons"
import { badge } from "../../ui/badge"
import { button } from "../../ui/button"
import { kbd, shortcut } from "../../ui/kbd"
import { link } from "../../ui/link"
import { loader } from "../../ui/loader"
import { toggleChip } from "../../ui/toggle-chip"
import { group, kitSection, pair, specimen } from "./chrome"
import { Message, type Model } from "./model"

type H = HtmlBuilder<Message>

const press = (label: string) => Message.PressedAction({ label })

const INTENTS = [
	{ intent: "primary", label: "Save changes" },
	{ intent: "secondary", label: "Invite people" },
	{ intent: "outline", label: "Export" },
	{ intent: "plain", label: "Cancel" },
	{ intent: "danger", label: "Delete channel" },
	{ intent: "warning", label: "Pause sync" },
] as const

const SIZES = ["xs", "sm", "md", "lg"] as const

const SQUARES = [
	{ size: "sq-xs", label: "Add, extra small" },
	{ size: "sq-sm", label: "Add, small" },
	{ size: "sq-md", label: "Add, medium" },
	{ size: "sq-lg", label: "Add, large" },
] as const

const BADGES = [
	{ intent: "primary", label: "New" },
	{ intent: "secondary", label: "Guest" },
	{ intent: "success", label: "Online" },
	{ intent: "info", label: "Beta" },
	{ intent: "warning", label: "Away" },
	{ intent: "danger", label: "Blocked" },
	{ intent: "outline", label: "Bot" },
	{ intent: "quiet", label: "Not set" },
	{ intent: "muted", label: "Paused" },
	{ intent: "success-outline", label: "Met" },
] as const

const WEEKDAYS = [
	{ key: "mon", label: "Mon", name: "Monday" },
	{ key: "tue", label: "Tue", name: "Tuesday" },
	{ key: "wed", label: "Wed", name: "Wednesday" },
	{ key: "thu", label: "Thu", name: "Thursday" },
	{ key: "fri", label: "Fri", name: "Friday" },
] as const

const buttons = (h: H): Html =>
	specimen(
		h,
		{
			name: "Button",
			file: "ui/button.ts",
			note: "One primary per view. Secondary and outline sit beside it, plain recedes, danger confirms a loss.",
			className: "flex-col items-start gap-6",
		},
		[
			group(
				h,
				"Intents",
				INTENTS.map((entry) =>
					h.keyed("span")(
						entry.intent,
						[h.Class("contents")],
						[button(h, { intent: entry.intent, onPress: press(entry.label) }, [entry.label])],
					),
				),
			),
			group(
				h,
				"Sizes",
				SIZES.map((size) =>
					h.keyed("span")(
						size,
						[h.Class("contents")],
						[button(h, { intent: "secondary", size, onPress: press(`Size ${size}`) }, [size])],
					),
				),
			),
			group(h, "With icons", [
				button(h, { intent: "primary", onPress: press("New channel") }, [IconPlus(h), "New channel"]),
				button(h, { intent: "outline", onPress: press("Export") }, [IconDownload(h), "Export"]),
				button(h, { intent: "secondary", onPress: press("Sort") }, ["Sort", IconChevronDown(h)]),
				button(h, { intent: "plain", onPress: press("Favorite") }, [IconStar(h), "Favorite"]),
			]),
			group(
				h,
				"Icon only",
				[
					...SQUARES.map((entry) =>
						h.keyed("span")(
							entry.size,
							[h.Class("contents")],
							[
								button(
									h,
									{
										intent: "outline",
										size: entry.size,
										onPress: press(entry.label),
										attributes: [h.AriaLabel(entry.label)],
									},
									[IconPlus(h)],
								),
							],
						),
					),
					button(
						h,
						{
							intent: "plain",
							size: "sq-sm",
							onPress: press("More"),
							attributes: [h.AriaLabel("More")],
						},
						[IconDots(h)],
					),
					button(
						h,
						{
							intent: "secondary",
							size: "sq-sm",
							isCircle: true,
							onPress: press("Notifications"),
							attributes: [h.AriaLabel("Notifications")],
						},
						[IconBell(h)],
					),
				],
				"items-end",
			),
			group(h, "States", [
				button(h, { intent: "primary", isDisabled: true }, ["Disabled"]),
				button(h, { intent: "outline", isDisabled: true }, ["Disabled"]),
				button(h, { intent: "primary", isPending: true }, [loader(h, {}), "Saving"]),
				button(h, { intent: "secondary", isPending: true }, [loader(h, {}), "Loading"]),
				button(h, { intent: "danger", onPress: press("Delete") }, [IconTrash(h), "Delete"]),
			]),
		],
	)

const badges = (h: H): Html =>
	specimen(
		h,
		{
			name: "Badge",
			file: "ui/badge.ts",
			note: "A state in a word. Subtle fills for a state that matters, outlines for one that does not yet.",
			className: "flex-col items-start gap-6",
		},
		[
			group(
				h,
				"Intents",
				BADGES.map((entry) =>
					h.keyed("span")(
						entry.intent,
						[h.Class("contents")],
						[badge(h, { intent: entry.intent }, [entry.label])],
					),
				),
			),
			group(h, "Sizes and shapes", [
				badge(h, { intent: "primary", size: "sm" }, ["Small"]),
				badge(h, { intent: "primary" }, ["Medium"]),
				badge(h, { intent: "secondary", isPill: true }, ["Pill"]),
				badge(h, { intent: "success" }, [IconStar(h), "With icon"]),
				badge(h, { intent: "secondary", size: "sm" }, ["12"]),
				badge(h, { intent: "danger", size: "sm", isPill: true }, ["99+"]),
			]),
		],
	)

const chips = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Toggle chip",
			file: "ui/toggle-chip.ts",
			note: "A pressable choice that stays pressed: weekdays, plans, filters. Pressed is a quiet tint.",
		},
		[
			...WEEKDAYS.map((day) =>
				h.keyed("span")(
					day.key,
					[h.Class("contents")],
					[
						toggleChip(h, {
							label: day.label,
							ariaLabel: day.name,
							isPressed: model.pressedChips.includes(day.key),
							onPress: Message.ToggledChip({ key: day.key }),
						}),
					],
				),
			),
			toggleChip(h, { label: "Sat", ariaLabel: "Saturday", isPressed: false, isDisabled: true }),
		],
	)

const links = (h: H): Html =>
	specimen(
		h,
		{
			name: "Link",
			file: "ui/link.ts",
			note: "Navigation inside text. It takes the color of the text it sits in unless a page gives it one.",
			className: "flex-col items-start",
		},
		[
			h.p(
				[h.Class("text-fg-3 text-sm")],
				[
					"Read the ",
					link(h, { href: "#foundations", className: "text-primary-subtle-fg hover:underline" }, [
						"design rules",
					]),
					" before adding a variant.",
				],
			),
			h.p(
				[h.Class("text-fg-3 text-sm")],
				[
					"Billing is managed by an owner: ",
					link(h, { href: "#actions", isDisabled: true }, ["open billing"]),
					".",
				],
			),
		],
	)

const keys = (h: H): Html =>
	specimen(
		h,
		{
			name: "Key cap",
			file: "ui/kbd.ts",
			note: "A shortcut, one cap per key. Shown beside the action it runs, never on its own.",
			className: "gap-6",
		},
		[
			group(h, "Medium", [
				shortcut(h, {}, ["⌘", "K"]),
				shortcut(h, {}, ["⇧", "⌘", "P"]),
				kbd(h, {}, "Enter"),
				kbd(h, {}, "Esc"),
			]),
			group(h, "Small", [
				shortcut(h, { size: "sm" }, ["⌘", "K"]),
				kbd(h, { size: "sm" }, "J"),
				kbd(h, { size: "sm" }, "K"),
			]),
		],
	)

export const actions = (h: H, model: Model): Html =>
	kitSection(h, "actions", [buttons(h), badges(h), pair(h, [chips(h, model), keys(h)]), links(h)])
