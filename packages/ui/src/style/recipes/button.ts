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
	"icon" | "label"
>({
	primitive: "button",
	parts: { icon: "part", label: "part" },
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
		parts: { icon: { shrink: false, bleedX: "0.5" } },
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
				// Seed (lane A2 matches today's DMs filter chips): fully round, filled while `selected`.
				chip: {
					root: { background: "transparent", color: "fg", radius: "full" },
					parts: { icon: { color: "muted-fg" } },
					states: {
						hover: { root: { background: "secondary" } },
						pressed: { root: { background: "secondary" } },
						selected: { root: { background: "secondary", color: "secondary-fg" } },
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
			},
		},
	},
	flags: { iconOnly: { root: { paddingX: "0", paddingY: "0" } }, circle: { root: { radius: "full" } } },
	compounds: [
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
