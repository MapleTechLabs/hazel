import { Schema } from "effect"
import { Runtime } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconHashtag, IconPlus } from "../../../../apps/web-foldkit/src/icons/index.ts"
import { button, type ButtonVariants } from "../../../../apps/web-foldkit/src/ui/button.ts"
import { sidebarItem, sidebarLabel, sidebarSection } from "../../../../apps/web-foldkit/src/ui/sidebar.ts"
import { applyTheme } from "./page.ts"
import { type ButtonSpec, buttons, type IconName, type ItemSpec, sections } from "./specimens.ts"

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

const item = (h: H, spec: ItemSpec): Html =>
	sidebarItem(
		h,
		{ isCurrent: spec.selected ?? false, attributes: [h.Attribute("data-specimen", spec.id)] },
		[
			icon(h, spec.icon),
			spec.emphasized ? emphasizedLabel(h, spec.title) : sidebarLabel(h, [spec.title]),
		],
	)

const intentOf = {
	primary: "primary",
	secondary: "secondary",
	outline: "outline",
	ghost: "plain",
	warning: "warning",
	danger: "danger",
} as const satisfies Record<ButtonSpec["variant"], ButtonVariants["intent"]>

const sizeOf = (spec: ButtonSpec): ButtonVariants["size"] => {
	const size = spec.size === "regular" ? "md" : spec.size === "small" ? "sm" : "xs"
	return spec.iconOnly ? `sq-${size}` : size
}

const kitButton = (h: H, spec: ButtonSpec): Html =>
	button(
		h,
		{
			intent: intentOf[spec.variant],
			size: sizeOf(spec),
			isDisabled: spec.disabled ?? false,
			isPending: spec.loading ?? false,
			attributes: [h.Attribute("data-specimen", spec.id)],
		},
		[...(spec.icon ? [icon(h, spec.icon)] : []), ...(spec.label ? [spec.label] : [])],
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
