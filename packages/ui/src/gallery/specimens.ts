import type { BadgeSize, BadgeStyle, BadgeTone, ButtonSize, ButtonVariant } from "../style/schema.ts"

/**
 * The gallery's content, shared by both sides: each specimen is drawn once by today's Foldkit kit
 * (`kit.ts`) and once as `data-hz` DOM styled only by the generated `tokens.css` (`hazel.ts`).
 */

export type IconName = "hashtag" | "plus"

export interface ItemSpec {
	readonly id: string
	readonly title: string
	readonly icon: IconName
	readonly selected?: boolean
	readonly emphasized?: boolean
}

export interface SectionSpec {
	readonly id: string
	readonly title: string
	readonly items: ReadonlyArray<ItemSpec>
}

export interface ButtonSpec {
	readonly id: string
	readonly variant: ButtonVariant
	readonly size: ButtonSize
	readonly label?: string
	readonly icon?: IconName
	readonly iconOnly?: boolean
	readonly circle?: boolean
	readonly disabled?: boolean
	readonly loading?: boolean
}

export const sections: ReadonlyArray<SectionSpec> = [
	{
		id: "section-channels",
		title: "Channels",
		items: [
			{ id: "item-default", title: "general", icon: "hashtag" },
			{ id: "item-selected", title: "design", icon: "hashtag", selected: true },
			{ id: "item-emphasized", title: "engineering", icon: "hashtag", emphasized: true },
			{ id: "item-long", title: "a-channel-name-long-enough-to-truncate", icon: "hashtag" },
		],
	},
]

const variants: ReadonlyArray<ButtonVariant> = [
	"primary",
	"secondary",
	"outline",
	"ghost",
	"warning",
	"danger",
]
const sizes: ReadonlyArray<ButtonSize> = ["large", "regular", "small", "xsmall"]

export const buttons: ReadonlyArray<ButtonSpec> = [
	...variants.flatMap((variant) =>
		sizes.map((size) => ({ id: `button-${variant}-${size}`, variant, size, label: "Invite" })),
	),
	...variants.map((variant) => ({
		id: `button-${variant}-icon-label`,
		variant,
		size: "regular" as const,
		label: "Invite",
		icon: "plus" as const,
	})),
	...(["ghost", "outline"] as const).flatMap((variant) =>
		sizes.map((size) => ({
			id: `button-${variant}-${size}-icon-only`,
			variant,
			size,
			icon: "plus" as const,
			iconOnly: true,
		})),
	),
	...(["primary", "outline", "ghost"] as const).flatMap((variant) =>
		(["large", "regular", "small"] as const).map((size) => ({
			id: `button-${variant}-${size}-circle`,
			variant,
			size,
			icon: "plus" as const,
			iconOnly: true,
			circle: true,
		})),
	),
	{ id: "button-primary-disabled", variant: "primary", size: "regular", label: "Invite", disabled: true },
	{ id: "button-secondary-loading", variant: "secondary", size: "regular", label: "Invite", loading: true },
]

export interface BadgeSpec {
	readonly id: string
	readonly tone: BadgeTone
	readonly style: BadgeStyle
	readonly size: BadgeSize
	readonly pill?: boolean
	readonly label: string
}

const tones: ReadonlyArray<BadgeTone> = ["neutral", "accent", "success", "warning", "danger", "info"]
const badgeSizes: ReadonlyArray<BadgeSize> = ["regular", "small"]

export const badges: ReadonlyArray<BadgeSpec> = badgeSizes.flatMap((size) => [
	...tones.map((tone) => ({ id: `badge-${tone}-${size}`, tone, style: "solid" as const, size, label: "Beta" })),
	{ id: `badge-neutral-outline-${size}`, tone: "neutral", style: "outline", size, label: "Draft" },
	{ id: `badge-success-outline-${size}`, tone: "success", style: "outline", size, label: "Met" },
	{ id: `badge-neutral-quiet-${size}`, tone: "neutral", style: "quiet", size, label: "Paused" },
	{ id: `badge-accent-${size}-pill`, tone: "accent", style: "solid", size, pill: true, label: "New" },
	{ id: `badge-neutral-outline-${size}-pill`, tone: "neutral", style: "outline", size, pill: true, label: "12" },
])

/** Every specimen id, in page order: the shot script walks this list on both sides. */
export const specimenIds: ReadonlyArray<string> = [
	...sections.flatMap((section) => [section.id, ...section.items.map((item) => item.id)]),
	...buttons.map((button) => button.id),
	...badges.map((badge) => badge.id),
]
