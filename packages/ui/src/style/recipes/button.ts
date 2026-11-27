import { defineRecipe } from "../recipe.ts"
import type { ButtonSize, ButtonVariant } from "../schema.ts"

/**
 * `button` (`apps/web-foldkit/src/core/components/ui/button.styles.ts`): intent `plain` is `ghost`;
 * sizes `lg`, `md`, `sm`, `xs` are `large`, `regular`, `small`, `xsmall`; `sq-*` are those with
 * `iconOnly`; `isCircle` is `circle`.
 */
export const button = defineRecipe<
	{ readonly variant: ButtonVariant; readonly size: ButtonSize },
	"iconOnly" | "circle",
	"icon" | "detail" | "label" | "trailingIcon" | "remove" | "shortcut"
>({
	primitive: "button",
	parts: {
		icon: "part",
		detail: "part",
		label: "part",
		trailingIcon: "part",
		remove: "part",
		shortcut: "part",
	},
	base: {
		root: {
			layout: "inline-row",
			align: "center",
			justify: "center",
			nowrap: true,
			borderWidth: "hairline",
			borderColor: "transparent",
			radius: "lg",
			strong: true,
			transition: "fast",
		},
		parts: {
			icon: { shrink: false, bleedX: "0.5" },
			// `Sort` before the sort's label, in muted ink.
			detail: { color: "muted-fg", shrink: false },
			trailingIcon: { size: "3", shrink: false, bleedX: "px", color: "muted-fg" },
			// A queue action's key (`pk0-action-shortcut`, `kbd(h, key, "-mr-0.5 h-4 min-w-4")`): a small
			// key cap after the label; hidden below `md` (the renderer's, as `max-md:hidden`).
			shortcut: {
				layout: "inline-row",
				align: "center",
				justify: "center",
				minHeight: "4",
				minWidth: "4",
				paddingX: "1",
				text: "micro",
				nowrap: true,
				strong: true,
				color: "fg-3",
				background: "bg",
				borderWidth: "hairline",
				borderColor: "border",
				radius: "sm",
				shadow: "xs",
				shrink: false,
			},
			// A filter chip's trailing remove mark (`filter-bar.ts` `filterChip`).
			remove: {
				size: "4",
				shrink: false,
				bleedX: "0.5",
				color: "muted-fg",
				radius: "sm",
				transition: "fast",
			},
		},
	},
	options: {
		variant: {
			default: "primary",
			values: {
				primary: {
					root: { background: "primary", color: "primary-fg", shadow: "control" },
					parts: { icon: { color: "primary-icon" } },
					states: {
						hover: {
							root: { background: "primary-hover" },
							parts: { icon: { color: "primary-icon-hover" } },
						},
						pressed: { root: { background: "primary-hover" } },
					},
				},
				secondary: {
					root: { background: "secondary", color: "secondary-fg" },
					parts: { icon: { color: "muted-fg" } },
					states: {
						hover: {
							root: { background: "secondary-hover" },
							parts: { icon: { color: "secondary-icon-hover" } },
						},
						pressed: { root: { background: "secondary-hover" } },
					},
				},
				outline: {
					root: { background: "transparent", color: "fg", borderColor: "border", shadow: "xs" },
					parts: { icon: { color: "muted-fg" } },
					states: {
						hover: {
							root: { background: "secondary", borderColor: "border-hover" },
							parts: { icon: { color: "fg" } },
						},
						pressed: { root: { background: "secondary" } },
					},
				},
				ghost: {
					root: { background: "transparent", color: "fg" },
					parts: { icon: { color: "muted-fg" } },
					states: {
						hover: { root: { background: "secondary" }, parts: { icon: { color: "fg" } } },
						pressed: { root: { background: "secondary" } },
					},
				},
				// toggle-chip.ts as the DMs filter uses it: outlined and muted, tinted while `selected`.
				chip: {
					root: {
						background: "transparent",
						color: "muted-fg",
						borderColor: "border",
						radius: "full",
					},
					parts: { icon: { color: "muted-fg" } },
					states: {
						selected: {
							root: {
								background: "chip-selected",
								borderColor: "chip-selected-border",
								color: "fg",
							},
						},
						hover: { root: { background: "secondary", color: "fg" } },
					},
				},
				// filter-bar.ts `filterChip`: `h-8 rounded-lg border bg-secondary/50 text-sm`, the
				// value medium and truncated; the remove half's divider is the renderer's.
				filter: {
					root: {
						background: "secondary-half",
						color: "fg",
						borderColor: "border",
						radius: "lg",
						paddingY: "0",
						text: "label",
						strong: false,
					},
					parts: {
						detail: { color: "muted-fg" },
						label: { truncate: true, strong: true },
						remove: { bleedX: "0", radius: "none" },
					},
				},
				// A toolbar's text action with no box (the composer's Attach, GIF and Emoji, `composer/view.ts`):
				// `p-0 font-semibold text-muted-fg text-xs hover:text-fg`, the icon `size-4 text-muted-fg`.
				quiet: {
					root: { background: "transparent", color: "muted-fg", radius: "xs", weight: "semibold" },
					parts: { icon: { color: "muted-fg" } },
					states: { hover: { root: { color: "fg" } } },
				},
				// `+ Filter`: the plain intent with `border-border border-dashed text-fg-3 hover:text-fg`.
				dashed: {
					root: {
						background: "transparent",
						color: "fg-3",
						borderColor: "border",
						borderStyle: "dashed",
					},
					parts: { icon: { color: "muted-fg" } },
					states: {
						hover: {
							root: { background: "secondary", color: "fg" },
							parts: { icon: { color: "fg" } },
						},
						pressed: { root: { background: "secondary" } },
					},
				},
				warning: {
					root: { background: "warning", color: "warning-fg", shadow: "control" },
					parts: { icon: { color: "warning-icon" } },
					states: {
						hover: {
							root: { background: "warning-hover" },
							parts: { icon: { color: "warning-icon-hover" } },
						},
						pressed: { root: { background: "warning-hover" } },
					},
				},
				danger: {
					root: { background: "danger", color: "danger-fg", shadow: "control" },
					parts: { icon: { color: "danger-icon" } },
					states: {
						hover: {
							root: { background: "danger-hover" },
							parts: { icon: { color: "danger-icon-hover" } },
						},
						pressed: { root: { background: "danger-hover" } },
					},
				},
			},
		},
		size: {
			default: "regular",
			values: {
				large: {
					root: {
						minHeight: "10",
						gap: "2",
						paddingX: { step: "3.5", lessBorder: true },
						paddingY: { step: "3", lessBorder: true },
						text: "body",
					},
					parts: { icon: { size: "5" } },
					regular: {
						root: {
							minHeight: "9",
							paddingX: "3",
							paddingY: { step: "1.5", lessBorder: true },
							leading: "7",
						},
						parts: { icon: { size: "4.5" } },
					},
				},
				regular: {
					root: {
						minHeight: "10",
						gap: "2",
						paddingX: { step: "3.5", lessBorder: true },
						paddingY: { step: "2.5", lessBorder: true },
						text: "body",
					},
					parts: { icon: { size: "5" } },
					regular: {
						root: {
							minHeight: "9",
							paddingX: "3",
							paddingY: { step: "1.5", lessBorder: true },
							leading: "6",
						},
						parts: { icon: { size: "4" } },
					},
				},
				small: {
					root: {
						minHeight: "9",
						gap: "1.5",
						paddingX: "3",
						paddingY: { step: "2", lessBorder: true },
						text: "body",
					},
					parts: { icon: { size: "4.5" } },
					regular: {
						root: {
							minHeight: "8",
							paddingX: { step: "3", lessBorder: true },
							paddingY: { step: "1.5", lessBorder: true },
						},
						parts: { icon: { size: "4" } },
					},
				},
				xsmall: {
					root: {
						minHeight: "8",
						gap: "1.5",
						paddingX: { step: "3", lessBorder: true },
						paddingY: { step: "1.5", lessBorder: true },
						text: "label",
					},
					parts: { icon: { size: "3.5", bleedX: "px" } },
					regular: {
						root: {
							minHeight: "7",
							paddingX: "2",
							paddingY: { step: "1.5", lessBorder: true },
							text: "caption",
						},
						parts: { icon: { size: "3" } },
					},
				},
				toolbar: {
					root: {
						minHeight: "10",
						gap: "1.5",
						paddingX: { step: "3", lessBorder: true },
						paddingY: { step: "1.5", lessBorder: true },
						text: "label",
					},
					parts: { icon: { size: "3.5", bleedX: "px" }, trailingIcon: { size: "3.5" } },
					regular: {
						root: {
							minHeight: "8",
							paddingX: "2",
							paddingY: { step: "1.5", lessBorder: true },
							text: "caption",
						},
						parts: { icon: { size: "3" }, trailingIcon: { size: "3" } },
					},
				},
			},
		},
	},
	flags: { iconOnly: { root: { paddingX: "0", paddingY: "0" } }, circle: { root: { radius: "full" } } },
	compounds: [
		// A chip has one size (`h-8 sm:h-7 px-3.5 text-sm`), so it overrides every `size`.
		{
			when: { variant: "chip" },
			style: {
				root: { minHeight: "8", gap: "1.5", paddingX: "3.5", paddingY: "0", text: "label" },
				regular: { root: { minHeight: "7", paddingX: "3.5", paddingY: "0", text: "label" } },
			},
		},
		// The filter chip keeps `text-sm` at every width; the value half pads `px-2.5`.
		{
			when: { variant: "filter" },
			style: {
				root: { paddingStart: "2.5", paddingX: "0", gap: "1", text: "label" },
				regular: { root: { paddingStart: "2.5", paddingX: "0", gap: "1", text: "label" } },
			},
		},
		// The quiet action has one size: no padding or minimum height, `gap-1.5 text-xs`.
		{
			when: { variant: "quiet" },
			style: {
				root: { minHeight: "0", gap: "1.5", paddingX: "0", paddingY: "0", text: "caption" },
				parts: { icon: { size: "4" } },
				regular: {
					root: { minHeight: "0", gap: "1.5", paddingX: "0", paddingY: "0", text: "caption" },
					parts: { icon: { size: "4" } },
				},
			},
		},
		// `sortTrigger`: `gap-1` between `Sort`, the label and the chevron.
		{ when: { size: "toolbar", variant: "ghost" }, style: { root: { gap: "1" } } },
		{
			when: { iconOnly: true, size: "large" },
			style: {
				root: { size: "12" },
				parts: { icon: { size: "6" } },
				regular: { root: { size: "10" }, parts: { icon: { size: "5" } } },
			},
		},
		{
			when: { iconOnly: true, size: "regular" },
			style: {
				root: { size: "11" },
				parts: { icon: { size: "5" } },
				regular: { root: { size: "9" }, parts: { icon: { size: "4.5" } } },
			},
		},
		{
			when: { iconOnly: true, size: "small" },
			style: {
				root: { size: "10" },
				parts: { icon: { size: "4.5" } },
				regular: { root: { size: "8" }, parts: { icon: { size: "4" } } },
			},
		},
		{
			when: { iconOnly: true, size: "xsmall" },
			style: {
				root: { size: "8" },
				parts: { icon: { size: "3.5", bleedX: "0.5" } },
				regular: { root: { size: "7" }, parts: { icon: { size: "3" } } },
			},
		},
	],
	states: { disabled: { root: { opacity: 0.5 } }, loading: { root: { opacity: 0.5 } } },
	inert: ["disabled", "loading"],
})
