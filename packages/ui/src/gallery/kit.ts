import { Schema } from "effect"
import { Runtime } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconHashtag, IconPlus } from "../../../../apps/web-foldkit/src/icons/index.ts"
import { CHANNEL_ACTIVE } from "../../../../apps/web-foldkit/src/ui/sidebar-tree.ts"
import { badge } from "../../../../apps/web-foldkit/src/ui/badge.ts"
import { button, type ButtonVariants } from "../../../../apps/web-foldkit/src/ui/button.ts"
import { toggleChip } from "../../../../apps/web-foldkit/src/ui/toggle-chip.ts"
import {
	sidebarItem,
	sidebarLabel,
	sidebarLink,
	sidebarSection,
} from "../../../../apps/web-foldkit/src/ui/sidebar.ts"
import { chartSpecimens } from "./kit-charts.ts"
import { chatSpecimens } from "./kit-chat.ts"
import { contentSpecimens } from "./kit-content.ts"
import { controlSpecimens } from "./kit-controls.ts"
import { rowSpecimens } from "./kit-rows.ts"
import { tableSpecimens } from "./kit-table.ts"
import { applyTheme } from "./page.ts"
import {
	type BadgeSpec,
	badges,
	type ButtonSpec,
	buttons,
	type IconName,
	type ItemSpec,
	sections,
} from "./specimens.ts"

/** The kit side: today's Foldkit components, rendered by Foldkit with the app's real stylesheet. */

type H = HtmlBuilder<never>

const icon = (h: H, name: IconName): Html => (name === "hashtag" ? IconHashtag(h) : IconPlus(h))

/** The channel row's emphasized label (`shell/channels-sidebar/items.ts`, `label` + `font-medium text-fg`). */
const emphasizedLabel = (h: H, title: string): Html =>
	h.span(
		[
			h.Class(
				"col-start-2 min-w-0 overflow-hidden whitespace-nowrap text-ellipsis outline-hidden font-medium text-fg",
			),
			h.Attribute("data-slot", "sidebar-label"),
			h.Attribute("tabindex", "-1"),
			h.Attribute("slot", "label"),
		],
		[title],
	)

/**
 * Every row is the app's channel row (`channelItem`): a `sidebarLink`, whose `font-medium` the label
 * takes; the selected one is active, with `CHANNEL_ACTIVE`.
 */
const item = (h: H, spec: ItemSpec): Html => {
	const content = [
		icon(h, spec.icon),
		spec.emphasized ? emphasizedLabel(h, spec.title) : sidebarLabel(h, [spec.title]),
	]
	const attributes = [h.Attribute("data-specimen", spec.id)]
	return sidebarItem(h, { attributes }, [
		sidebarLink(
			h,
			{ href: "#", isActive: spec.selected === true, activeClassName: CHANNEL_ACTIVE },
			content,
		),
	])
}

const intentOf = {
	primary: "primary",
	secondary: "secondary",
	outline: "outline",
	ghost: "plain",
	warning: "warning",
	danger: "danger",
	// A chip is `toggleChip` (`kitChip`), never a kit button; these entries only close the map (the
	// filter and dashed buttons are the customers filter bar's, `kit-controls.ts`).
	chip: "plain",
	filter: "plain",
	dashed: "plain",
	// The composer's picker buttons are a plain `ariaButton` with their own classes, not a kit button.
	quiet: "plain",
} as const satisfies Record<ButtonSpec["variant"], ButtonVariants["intent"]>

const sizeOf = (spec: ButtonSpec): ButtonVariants["size"] => {
	const size = { large: "lg", regular: "md", small: "sm", xsmall: "xs", toolbar: "xs" } as const
	return spec.iconOnly ? `sq-${size[spec.size]}` : size[spec.size]
}

/**
 * The DMs filter chip (`page/chat-index/mobile-dms.ts`): `toggleChip` with its round override, in a
 * shrink-wrapped span that carries the specimen id (the chip takes no attributes).
 */
const kitChip = (h: H, spec: ButtonSpec): Html =>
	h.span(
		[h.Class("inline-flex"), h.Attribute("data-specimen", spec.id)],
		[
			toggleChip(h, {
				label: spec.label ?? "",
				isPressed: spec.selected ?? false,
				className: "h-8 rounded-full px-3.5",
			}),
		],
	)

const kitButton = (h: H, spec: ButtonSpec): Html =>
	spec.variant === "chip"
		? kitChip(h, spec)
		: button(
				h,
				{
					intent: intentOf[spec.variant],
					size: sizeOf(spec),
					isCircle: spec.circle ?? false,
					isDisabled: spec.disabled ?? false,
					isPending: spec.loading ?? false,
					attributes: [h.Attribute("data-specimen", spec.id)],
				},
				[...(spec.icon ? [icon(h, spec.icon)] : []), ...(spec.label ? [spec.label] : [])],
			)

type BadgeIntent = Parameters<typeof badge>[1]["intent"]

/** The kit intent each tone and style is (`style/recipes/badge.ts`). */
const intentOfBadge = (spec: BadgeSpec): BadgeIntent => {
	if (spec.style === "quiet") return "muted"
	if (spec.style === "outline") return spec.tone === "success" ? "success-outline" : "outline"
	const solid = {
		neutral: "secondary",
		accent: "primary",
		success: "success",
		warning: "warning",
		danger: "danger",
		info: "info",
	} as const
	return solid[spec.tone]
}

const kitBadge = (h: H, spec: BadgeSpec): Html =>
	badge(
		h,
		{
			intent: intentOfBadge(spec),
			size: spec.size === "regular" ? "md" : "sm",
			isPill: spec.pill ?? false,
			attributes: [h.Attribute("data-specimen", spec.id)],
		},
		[spec.label],
	)

const view = (h: H): Html =>
	h.div(
		[h.Class("gallery")],
		[
			h.div(
				[h.Class("frames")],
				sections.map((section) =>
					h.div(
						[h.Class("frame-sidebar"), h.Attribute("data-specimen", section.id)],
						[
							sidebarSection(
								h,
								{ label: section.title },
								section.items.map((spec) => item(h, spec)),
							),
						],
					),
				),
			),
			h.div(
				[h.Class("frames frame-buttons")],
				buttons.map((spec) => h.div([h.Class("frame-button")], [kitButton(h, spec)])),
			),
			h.div(
				[h.Class("frames frame-buttons")],
				badges.map((spec) => h.div([h.Class("frame-button")], [kitBadge(h, spec)])),
			),
			chatSpecimens(h),
			contentSpecimens(h),
			controlSpecimens(h),
			// After the other kit specimens: the DM row (80.5px on a phone) and the charts' heights are off the
			// pixel grid, so anything placed after them crops at a fractional offset.
			rowSpecimens(h),
			tableSpecimens(h),
			chartSpecimens(h),
		],
	)

applyTheme()
const container = document.getElementById("app")
if (container === null) throw new Error("kit.html has no #app")
Runtime.run(
	Runtime.makeElement({
		Model: Schema.Struct({}),
		init: () => ({ model: {} }),
		update: (model: {}) => ({ model }),
		view: (_model: {}, h: H) => view(h),
		container,
	}),
)
