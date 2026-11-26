import { defineRecipe } from "../recipe.ts"
import type { AvatarPresence, AvatarSize, ProviderMark } from "../schema.ts"

/**
 * `avatar`: initials in a filled circle, sized like the icon it stands beside, or the `src` image over
 * them. `large` is the settings logo (the kit's `lg`, `size-12 rounded-xl`). `presence` is the kit's
 * presence dot (`presence-dot.ts`: online, away, busy filled; offline a hollow ring) and `mark` a
 * provider's logo, both at the bottom-right corner (placed by the web renderer).
 */
export const avatar = defineRecipe<
	{ readonly size: AvatarSize; readonly presence: AvatarPresence; readonly mark: ProviderMark },
	never,
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
			background: "primary",
			color: "primary-fg",
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
			},
		},
		presence: {
			default: "none",
			values: {
				none: {},
				online: { parts: { presence: { background: "success" } } },
				away: { parts: { presence: { background: "warning" } } },
				busy: { parts: { presence: { background: "danger" } } },
				offline: { parts: { presence: { background: "bg", ring: "muted-fg" } } },
			},
		},
		mark: { default: "none", values: { none: {}, slack: {}, discord: {} } },
	},
})
