import { defineRecipe } from "../recipe.ts"
import type { BadgeTone, BannerStyle } from "../schema.ts"

/**
 * `hz:banner` (phase 4): the kit's callout (`ui/callout.ts`) and the chat's new-messages band. Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A1 fills it from today's kit (lane D reviews).
 */
export const banner = defineRecipe<
	{ readonly tone: BadgeTone; readonly style: BannerStyle },
	never,
	"icon" | "title" | "description" | "content" | "actions" | "dismiss"
>({
	primitive: "banner",
	parts: {
		icon: "part",
		title: "part",
		description: "part",
		content: "part",
		actions: "slot",
		dismiss: "part",
	},
	base: { root: {} },
	options: {
		tone: {
			default: "info",
			values: { neutral: {}, accent: {}, success: {}, warning: {}, danger: {}, info: {} },
		},
		style: {
			default: "callout",
			values: { callout: {}, bar: {} },
		},
	},
})
