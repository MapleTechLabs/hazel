import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	IconChartBar,
	IconCheck,
	IconClock,
	IconCube,
	IconEnvelope,
	IconHeart,
	IconLightbulb,
	IconMegaphone,
	IconOffice,
	IconPin,
	IconRocket,
	IconShop,
	IconSparkles,
	IconStar,
	IconUser,
	IconUsers,
	IconWarning,
	type IconOptions,
} from "../../icons"
import { button } from "../../ui/button"

/**
 * A saved view's look in its tab and the sidebar: an icon, or a dot, tinted by its colour. The
 * built-ins and the two fixed tabs ship one; a view that sets neither shows a muted dot.
 */

export interface ViewLook {
	readonly icon: Customers.ViewIcon | null
	readonly color: Customers.ViewColor | null
}

const ICONS = {
	star: IconStar,
	heart: IconHeart,
	rocket: IconRocket,
	lightbulb: IconLightbulb,
	sparkles: IconSparkles,
	warning: IconWarning,
	clock: IconClock,
	chart: IconChartBar,
	office: IconOffice,
	shop: IconShop,
	cube: IconCube,
	pin: IconPin,
	megaphone: IconMegaphone,
	envelope: IconEnvelope,
	user: IconUser,
	users: IconUsers,
} as const satisfies Record<Customers.ViewIcon, <M>(h: HtmlBuilder<M>, options?: IconOptions) => Html>

/** Important: sidebar rows and tabs tint every `data-slot="icon"` their own way. */
const TEXT = {
	gray: "text-view-gray!",
	red: "text-view-red!",
	orange: "text-view-orange!",
	yellow: "text-view-yellow!",
	green: "text-view-green!",
	teal: "text-view-teal!",
	blue: "text-view-blue!",
	purple: "text-view-purple!",
	pink: "text-view-pink!",
} as const satisfies Record<Customers.ViewColor, string>

const FILL = {
	gray: "bg-view-gray",
	red: "bg-view-red",
	orange: "bg-view-orange",
	yellow: "bg-view-yellow",
	green: "bg-view-green",
	teal: "bg-view-teal",
	blue: "bg-view-blue",
	purple: "bg-view-purple",
	pink: "bg-view-pink",
} as const satisfies Record<Customers.ViewColor, string>

export const COLOR_NAME = {
	gray: "Gray",
	red: "Red",
	orange: "Orange",
	yellow: "Yellow",
	green: "Green",
	teal: "Teal",
	blue: "Blue",
	purple: "Purple",
	pink: "Pink",
} as const satisfies Record<Customers.ViewColor, string>

const ICON_NAME = {
	star: "Star",
	heart: "Heart",
	rocket: "Rocket",
	lightbulb: "Light bulb",
	sparkles: "Sparkles",
	warning: "Warning",
	clock: "Clock",
	chart: "Chart",
	office: "Office",
	shop: "Shop",
	cube: "Cube",
	pin: "Pin",
	megaphone: "Megaphone",
	envelope: "Envelope",
	user: "Person",
	users: "People",
} as const satisfies Record<Customers.ViewIcon, string>

/** What the built-ins, "Current customers" (`current`) and "All customers" (`all`) ship with. */
const SHIPPED = {
	current: { icon: null, color: "purple" },
	all: { icon: null, color: "gray" },
	my_customers: { icon: "user", color: null },
	paying: { icon: null, color: "green" },
	trialing: { icon: null, color: "blue" },
	at_risk: { icon: null, color: "orange" },
	churned: { icon: null, color: "gray" },
} as const satisfies Record<Customers.BuiltInViewKey | "current" | "all", ViewLook>

const isShippedKey = (key: string): key is keyof typeof SHIPPED => Object.hasOwn(SHIPPED, key)

const NONE: ViewLook = { icon: null, color: null }

/** A view's look: its own, else (nothing set) what its key ships with. */
export const lookOf = (key: string, own: ViewLook | null): ViewLook =>
	own !== null && (own.icon !== null || own.color !== null)
		? { icon: own.icon, color: own.color }
		: isShippedKey(key)
			? SHIPPED[key]
			: NONE

/** The icon or dot, in a `size-4` box (`data-slot="icon"`, so sidebar rows lay it out). */
export const viewGlyph = <M>(h: HtmlBuilder<M>, look: ViewLook, className?: string): Html =>
	look.icon !== null
		? ICONS[look.icon](h, {
				className: twMerge(
					"size-4! shrink-0",
					look.color === null ? "text-muted-fg" : TEXT[look.color],
					className,
				),
				attributes: { "data-slot": "icon" },
			})
		: h.span(
				[
					h.Attribute("data-slot", "icon"),
					h.AriaHidden(true),
					h.Class(twMerge("flex size-4 shrink-0 items-center justify-center", className)),
				],
				[
					h.span([
						h.Class(
							twMerge(
								"size-2 rounded-full",
								look.color === null ? "bg-muted-fg/60" : FILL[look.color],
							),
						),
					]),
				],
			)

// PICKER

export interface LookPickerOptions<M> {
	readonly look: ViewLook
	readonly icons: ReadonlyArray<Customers.ViewIcon>
	readonly colors: ReadonlyArray<Customers.ViewColor>
	readonly onPick: (look: ViewLook) => M
}

const swatchClass = (isSelected: boolean) =>
	twMerge("size-8 p-0", isSelected ? "bg-secondary ring-1 ring-fg/15" : "")

/** The colour swatches, then "Dot" and the icons, in the colour picked. */
export const lookPicker = <M>(h: HtmlBuilder<M>, options: LookPickerOptions<M>): Html => {
	const { look } = options
	const tint = (color: Customers.ViewColor | null) => (color === null ? "text-muted-fg!" : TEXT[color])
	return h.div(
		[h.Class("flex flex-col gap-3")],
		[
			h.div(
				[h.Role("group"), h.AriaLabel("Colour"), h.Class("flex flex-wrap gap-1")],
				[null, ...options.colors].map((color) =>
					button(
						h,
						{
							intent: "plain",
							size: "xs",
							className: swatchClass(look.color === color),
							onPress: options.onPick({ ...look, color }),
							attributes: [
								h.AriaLabel(color === null ? "No colour" : COLOR_NAME[color]),
								h.AriaPressed(look.color === color ? "true" : "false"),
							],
						},
						[
							h.span(
								[
									h.AriaHidden(true),
									h.Class(
										twMerge(
											"flex size-4 items-center justify-center rounded-full",
											color === null ? "bg-muted-fg/40" : FILL[color],
										),
									),
								],
								look.color === color
									? [IconCheck(h, { className: "size-3 text-white" })]
									: [],
							),
						],
					),
				),
			),
			h.div(
				[h.Role("group"), h.AriaLabel("Icon"), h.Class("flex flex-wrap gap-1")],
				[null, ...options.icons].map((icon) =>
					button(
						h,
						{
							intent: "plain",
							size: "xs",
							className: swatchClass(look.icon === icon),
							onPress: options.onPick({ ...look, icon }),
							attributes: [
								h.AriaLabel(icon === null ? "Dot" : ICON_NAME[icon]),
								h.AriaPressed(look.icon === icon ? "true" : "false"),
							],
						},
						[
							icon === null
								? viewGlyph(h, { icon: null, color: look.color })
								: ICONS[icon](h, { className: twMerge("size-4!", tint(look.color)) }),
						],
					),
				),
			),
		],
	)
}
