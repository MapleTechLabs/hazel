import { defineRecipe } from "../recipe.ts"
import type { AvatarPresence, AvatarSize, ProviderMark } from "../schema.ts"

/**
 * `avatar`: sized like the icon it stands beside; the `src` image, else today's dither seeded by
 * `name` (drawn by the web renderer), else `initials` on the kit's muted fill. `large` is the
 * settings logo (the kit's `lg`, `size-12 rounded-xl`). `presence` is the kit's presence dot (`presence-dot.ts`: online, away, busy filled; offline a hollow ring) and `mark` a
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
	},
})
