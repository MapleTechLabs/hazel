import { defineRecipe } from "../recipe.ts"
import type { ProviderMark } from "../schema.ts"

/**
 * `hz:channelIcon` (`ui/channel-icon.ts`, size `sm`): the glyph (`#`, a lock, the emoji or the
 * customer's logo) at the icon size, `size-5 sm:size-4`, in its row's ink. Marks are `size-3` discs
 * cut from the page: the private customer's lock, up to two partners' logos, the sync provider's
 * logo. The web renderer places the marks (absolute offsets) and colours the logos by name.
 */
export const channelIcon = defineRecipe<
	{ readonly sync: ProviderMark },
	"private" | "tile",
	"glyph" | "emoji" | "logo" | "lock" | "lockIcon" | "partners" | "partner" | "sync" | "syncLogo"
>({
	primitive: "channelIcon",
	parts: {
		glyph: "part",
		emoji: "part",
		logo: "part",
		lock: "part",
		lockIcon: { kind: "part", in: "lock" },
		partners: "part",
		partner: { kind: "part", in: "partners" },
		sync: "part",
		syncLogo: { kind: "part", in: "sync" },
	},
	base: {
		root: { layout: "inline-row", align: "center", justify: "center", shrink: false },
		parts: {
			glyph: { size: "5" },
			emoji: {
				layout: "inline-row",
				align: "center",
				justify: "center",
				size: "5",
				text: "body",
				leading: "4",
			},
			logo: {
				layout: "inline-row",
				align: "center",
				justify: "center",
				size: "5",
				radius: "sm",
				text: "micro",
				weight: "semibold",
				shrink: false,
			},
			lock: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "3",
				radius: "full",
				background: "bg",
			},
			lockIcon: { size: "2" },
			partners: { layout: "row", align: "end" },
			partner: {
				layout: "inline-row",
				align: "center",
				justify: "center",
				size: "3",
				radius: "sm",
				text: "micro",
				leading: "3",
				weight: "semibold",
				shrink: false,
			},
			sync: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "3",
				radius: "full",
				background: "bg",
			},
			syncLogo: { size: "2" },
		},
		regular: {
			parts: { glyph: { size: "4" }, emoji: { size: "4", leading: "3.5" }, logo: { size: "4" } },
		},
	},
	options: {
		sync: {
			default: "none",
			// Slack's mark keeps its own colours; Discord's is one path in its brand blue.
			values: { none: {}, slack: {}, discord: { parts: { syncLogo: { color: "discord" } } } },
		},
	},
	flags: {
		private: {},
		// Channel settings' header (`p4-channel-settings-header`): a `size-10 rounded-lg bg-secondary`
		// tile around the `md` icon (`size-5`, the emoji `text-lg/none`) in muted ink.
		tile: {
			root: { size: "10", radius: "lg", background: "secondary", color: "muted-fg" },
			parts: {
				glyph: { size: "5" },
				emoji: { size: "5", text: "title", leading: "4.5" },
				logo: { size: "5" },
			},
			regular: {
				parts: { glyph: { size: "5" }, emoji: { size: "5", leading: "4.5" }, logo: { size: "5" } },
			},
		},
	},
})
