import type { Theme } from "@hazel/domain/models"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { GRAY_PALETTE_LABELS, RADIUS_LABELS } from "~/lib/theme/presets"
import { IconArrowPath } from "../../../icons"
import type { AriaRadio } from "../../../ui/aria-radio"
import type { Customization } from "./model"
import { presetPreviewRadius, radiusSelectorPreview, remixDotRadius, remixGrayLabel } from "./presets"

/** Ports of `components/theme/*`: preset cards, radius options, gray palette preview, remix cards. */

const flexCenter = { display: "flex", alignItems: "center", justifyContent: "center" } as const

/** `ThemePreview`: a navbar, sidebar and button mockup in the preset's colors. */
const themePreview = <M>(h: HtmlBuilder<M>, customization: Customization): Html => {
	const radius = presetPreviewRadius[customization.radius]
	const bar = (className: string) => h.div([h.Class(className)], [])
	return h.div(
		[h.Class("flex h-full w-full flex-col")],
		[
			h.div(
				[h.Class("flex h-3 w-full items-center gap-1 border-b border-border/50 bg-bg px-1.5")],
				[1, 2, 3].map(() => bar("size-1 rounded-full bg-muted-fg/30")),
			),
			h.div(
				[h.Class("flex flex-1")],
				[
					h.div(
						[h.Class("flex w-5 flex-col gap-1 border-r border-border/50 bg-bg p-1")],
						[
							bar("h-1.5 w-full rounded-sm bg-muted-fg/20"),
							h.div(
								[
									h.Class("h-1.5 w-full"),
									h.Style({
										backgroundColor: customization.primary,
										borderRadius: radius,
										opacity: "0.9",
									}),
								],
								[],
							),
							bar("h-1.5 w-full rounded-sm bg-muted-fg/20"),
						],
					),
					h.div(
						[h.Class("flex flex-1 flex-col gap-1.5 p-2")],
						[
							bar("h-1.5 w-3/4 rounded-sm bg-muted-fg/20"),
							bar("h-1.5 w-1/2 rounded-sm bg-muted-fg/15"),
							h.div(
								[h.Class("mt-auto flex gap-1")],
								[
									h.div(
										[
											h.Class("h-3 w-8 text-[4px] font-medium text-white"),
											h.Style({
												backgroundColor: customization.primary,
												borderRadius: radius,
												...flexCenter,
											}),
										],
										["Save"],
									),
									h.div(
										[
											h.Class("h-3 w-6 border bg-secondary text-[4px] text-muted-fg"),
											h.Style({ borderRadius: radius, ...flexCenter }),
										],
										["No"],
									),
								],
							),
						],
					),
				],
			),
		],
	)
}

/** `ThemePresetCard` */
export const themePresetCard = <M>(
	h: HtmlBuilder<M>,
	radio: AriaRadio,
	preset: Theme.ThemePreset,
	isSelected: boolean,
) =>
	radio(
		preset.id,
		{ className: "group flex cursor-pointer flex-col gap-2", ariaLabel: preset.name },
		({ isFocusVisible }) => [
			h.div(
				[
					h.Class(
						twMerge(
							"relative flex h-20 w-28 flex-col overflow-hidden rounded-lg border-2 bg-secondary transition-all",
							isSelected
								? "border-ring ring-2 ring-ring/20"
								: "border-border hover:border-muted-fg/50",
							isFocusVisible && "ring-2 ring-ring/40",
						),
					),
				],
				[themePreview(h, preset.customization)],
			),
			h.div(
				[h.Class("flex flex-col")],
				[
					h.span(
						[h.Class(twMerge("font-medium text-sm", isSelected ? "text-fg" : "text-muted-fg"))],
						[preset.name],
					),
				],
			),
		],
	)

/** `RadiusSelector`'s `RadiusOption` */
export const radiusOption = <M>(
	h: HtmlBuilder<M>,
	radio: AriaRadio,
	preset: Theme.RadiusPreset,
	isSelected: boolean,
) =>
	radio(
		preset,
		{ className: "group cursor-pointer", ariaLabel: RADIUS_LABELS[preset] },
		({ isFocusVisible }) => [
			h.div(
				[
					h.Class(
						twMerge(
							"flex items-center gap-2 rounded-lg border px-3 py-2 transition-all",
							isSelected
								? "border-ring bg-primary-subtle/10 ring-2 ring-ring/20"
								: "border-border hover:border-muted-fg/50 hover:bg-secondary/50",
							isFocusVisible && "ring-2 ring-ring/40",
						),
					),
				],
				[
					h.div(
						[
							h.Class(
								twMerge(
									"size-6 border-2",
									isSelected
										? "border-primary bg-primary-subtle/50"
										: "border-muted-fg/30 bg-muted",
								),
							),
							h.Style({ borderRadius: radiusSelectorPreview[preset] }),
						],
						[],
					),
					h.span(
						[h.Class(twMerge("text-sm", isSelected ? "font-medium text-fg" : "text-muted-fg"))],
						[RADIUS_LABELS[preset]],
					),
				],
			),
		],
	)

/** `GrayPalettePreview` with `showLabel` (the Select trigger and its items). */
export const grayPalettePreview = <M>(h: HtmlBuilder<M>, palette: Theme.GrayPalette): Html =>
	h.div(
		[h.Class("flex items-center gap-3")],
		[
			h.div(
				[h.Class("flex -space-x-0.5"), h.DataAttribute("slot", "icon")],
				["200", "400", "600", "800"].map((shade) =>
					h.div(
						[
							h.Class("size-4 rounded-full ring-1 ring-bg"),
							h.Style({ backgroundColor: `var(--color-${palette}-${shade})` }),
						],
						[],
					),
				),
			),
			h.span([h.Class("text-fg text-sm")], [GRAY_PALETTE_LABELS[palette]]),
		],
	)

/** `RemixOptionCard` */
export const remixOptionCard = <M>(
	h: HtmlBuilder<M>,
	key: string,
	customization: Customization,
	onSelect: M,
): Html =>
	h.keyed("button")(
		key,
		[
			h.Type("button"),
			h.OnClick(onSelect),
			h.Class(
				twMerge(
					"group flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition-all",
					"hover:border-muted-fg/50 hover:bg-secondary/50",
					"focus:outline-none focus:ring-2 focus:ring-ring/40",
				),
			),
		],
		[
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					h.div(
						[
							h.Class("size-8 rounded-md shadow-sm"),
							h.Style({ backgroundColor: customization.primary }),
						],
						[],
					),
					h.div(
						[h.Class("flex flex-col")],
						[
							h.span(
								[h.Class("font-mono text-xs text-fg")],
								[customization.primary.toUpperCase()],
							),
							h.span(
								[h.Class("text-muted-fg text-xs")],
								[remixGrayLabel(customization.grayPalette)],
							),
						],
					),
				],
			),
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					h.div(
						[h.Class("flex gap-0.5")],
						[1, 2, 3].map((i) =>
							h.div(
								[
									h.Class("size-2"),
									h.Style({
										backgroundColor: customization.primary,
										borderRadius: remixDotRadius[customization.radius],
										opacity: String(0.3 + i * 0.2),
									}),
								],
								[],
							),
						),
					),
					h.span([h.Class("text-muted-fg text-xs")], [RADIUS_LABELS[customization.radius]]),
				],
			),
			h.div(
				[h.Class("mt-1")],
				[
					h.span(
						[h.Class("font-medium text-primary text-xs group-hover:underline")],
						["Apply theme"],
					),
				],
			),
		],
	)

export const generateIcon = <M>(h: HtmlBuilder<M>) => IconArrowPath(h, { className: "mr-2 size-4" })
