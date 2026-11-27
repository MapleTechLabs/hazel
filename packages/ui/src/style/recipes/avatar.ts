import { defineRecipe } from "../recipe.ts"
import type { AvatarPresence, AvatarShape, AvatarSize, AvatarTint, ProviderMark } from "../schema.ts"

/**
 * `avatar`: sized like the icon it stands beside; the `src` image, else today's dither seeded by
 * `name` (drawn by the web renderer), else `initials` on the kit's muted fill. `large` is the
 * settings logo (the kit's `lg`, `size-12 rounded-xl`). `presence` is the kit's presence dot (`presence-dot.ts`: online, away, busy filled; offline a hollow ring) and `mark` a
 * provider's logo, both at the bottom-right corner (placed by the web renderer). Phase 4 (PK0):
 * the kit's other steps, `shape` (`square` takes today's logo radius per size), initials on a
 * `tint` (semibold, as `identity.ts`), and `placeholder`, a dashed ring around a user glyph.
 */
export const avatar = defineRecipe<
	{
		readonly size: AvatarSize
		readonly presence: AvatarPresence
		readonly mark: ProviderMark
		readonly shape: AvatarShape
		readonly tint: AvatarTint
	},
	"placeholder",
	"initials" | "image" | "presence" | "mark"
>({
	primitive: "avatar",
	parts: { initials: "part", image: "part", presence: "part", mark: "part" },
	base: {
		root: {
			layout: "row",
			align: "center",
			justify: "center",
			size: "5",
			radius: "full",
			background: "muted",
			color: "muted-fg",
			text: "micro",
			strong: true,
			shrink: false,
		},
		parts: {
			image: { size: "5", radius: "full" },
			presence: { size: "2", radius: "full", borderWidth: "hairline", borderColor: "bg" },
			mark: { size: "2.5", radius: "xs", background: "bg", color: "fg" },
		},
		regular: { root: { size: "4" }, parts: { image: { size: "4" }, presence: { size: "1.5" } } },
		states: { focusVisible: { root: { ring: "ring" } } },
	},
	options: {
		size: {
			default: "regular",
			values: {
				regular: {},
				// The kit's `md` (`size-10 rounded-xl`): DM and activity rows.
				medium: {
					root: { size: "10", radius: "xl", text: "label" },
					parts: {
						image: { size: "10", radius: "xl" },
						presence: { size: "2.5" },
						mark: { size: "3.5" },
					},
					regular: {
						root: { size: "10" },
						parts: { image: { size: "10" }, presence: { size: "2.5" } },
					},
				},
				large: {
					root: { size: "12", radius: "xl", text: "title" },
					parts: {
						image: { size: "12", radius: "xl" },
						presence: { size: "3" },
						mark: { size: "4" },
					},
					regular: {
						root: { size: "12" },
						parts: { image: { size: "12" }, presence: { size: "3" } },
					},
				},
				// The kit's `xxs`, `xs`, `sm` and `xl` (`avatar/styles.ts`); `inline` and `row` are
				// customers' 20 and 28pt logos (`identity.ts` `LOGO_SIZE`), the same at every width.
				xxsmall: {
					root: { size: "4", radius: "full", text: "micro" },
					parts: { image: { size: "4", radius: "full" } },
					regular: { root: { size: "4" }, parts: { image: { size: "4" } } },
				},
				xsmall: {
					root: { size: "6", radius: "full", text: "micro" },
					parts: { image: { size: "6", radius: "full" } },
					regular: { root: { size: "6" }, parts: { image: { size: "6" } } },
				},
				small: {
					root: { size: "8", radius: "full", text: "caption" },
					parts: { image: { size: "8", radius: "full" } },
					regular: { root: { size: "8" }, parts: { image: { size: "8" } } },
				},
				xlarge: {
					root: { size: "14", radius: "xl", text: "title" },
					parts: { image: { size: "14", radius: "xl" } },
					regular: { root: { size: "14" }, parts: { image: { size: "14" } } },
				},
				inline: {
					root: { size: "5", radius: "full", text: "micro" },
					parts: { image: { size: "5", radius: "full" } },
					regular: { root: { size: "5" }, parts: { image: { size: "5" } } },
				},
				row: {
					root: { size: "7", radius: "full", text: "tiny" },
					parts: { image: { size: "7", radius: "full" } },
					regular: { root: { size: "7" }, parts: { image: { size: "7" } } },
				},
			},
		},
		presence: {
			default: "none",
			values: {
				none: {},
				online: { parts: { presence: { background: "presence-online" } } },
				away: { parts: { presence: { background: "presence-away" } } },
				// Amber, as the kit's busy dot (`presence-busy-tone`).
				busy: { parts: { presence: { background: "presence-busy" } } },
				offline: { parts: { presence: { background: "bg", ring: "presence-offline" } } },
			},
		},
		mark: { default: "none", values: { none: {}, slack: {}, discord: {} } },
		shape: {
			default: "auto",
			values: {
				auto: {},
				round: { root: { radius: "full" }, parts: { image: { radius: "full" } } },
				square: {},
			},
		},
		// `identity.ts` `TINTS`: the theme's subtle pairs.
		tint: {
			default: "none",
			values: {
				none: {},
				accent: {
					root: { background: "primary-subtle", color: "primary-subtle-fg", weight: "semibold" },
				},
				info: { root: { background: "info-subtle", color: "info-subtle-fg", weight: "semibold" } },
				success: {
					root: { background: "success-subtle", color: "success-subtle-fg", weight: "semibold" },
				},
				warning: {
					root: { background: "warning-subtle", color: "warning-subtle-fg", weight: "semibold" },
				},
				danger: {
					root: { background: "danger-subtle", color: "danger-subtle-fg", weight: "semibold" },
				},
				neutral: { root: { background: "secondary", color: "secondary-fg", weight: "semibold" } },
			},
		},
	},
	flags: {
		// `border border-muted-fg/60 border-dashed bg-transparent`; the renderer dashes it and draws the glyph.
		placeholder: {
			root: {
				background: "transparent",
				borderWidth: "hairline",
				borderColor: "placeholder-edge",
				color: "muted-fg",
			},
		},
	},
	// Today's logo radii (`LOGO_SIZE`): 16 and 20 `sm`, 28 `md`, 40 `lg`, 48 and 56 `xl`.
	compounds: [
		{
			when: { shape: "square", size: "xxsmall" },
			style: { root: { radius: "sm" }, parts: { image: { radius: "sm" } } },
		},
		{
			when: { shape: "square", size: "inline" },
			style: { root: { radius: "sm" }, parts: { image: { radius: "sm" } } },
		},
		{
			when: { shape: "square", size: "regular" },
			style: { root: { radius: "sm" }, parts: { image: { radius: "sm" } } },
		},
		{
			when: { shape: "square", size: "xsmall" },
			style: { root: { radius: "md" }, parts: { image: { radius: "md" } } },
		},
		{
			when: { shape: "square", size: "row" },
			style: { root: { radius: "md" }, parts: { image: { radius: "md" } } },
		},
		{
			when: { shape: "square", size: "small" },
			style: { root: { radius: "lg" }, parts: { image: { radius: "lg" } } },
		},
		{
			when: { shape: "square", size: "medium" },
			style: { root: { radius: "lg" }, parts: { image: { radius: "lg" } } },
		},
		{
			when: { shape: "square", size: "large" },
			style: { root: { radius: "xl" }, parts: { image: { radius: "xl" } } },
		},
		{
			when: { shape: "square", size: "xlarge" },
			style: { root: { radius: "xl" }, parts: { image: { radius: "xl" } } },
		},
	],
})
