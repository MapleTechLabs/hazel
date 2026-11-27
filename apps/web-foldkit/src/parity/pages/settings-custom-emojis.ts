import type { ComparePage } from "../compare-entry"

/** `/hazel/settings/custom-emojis` for the owner: the upload zone and three emojis. */
export default {
	flag: "hazel:native:SettingsCustomEmojis",
	href: "/hazel/settings/custom-emojis",
	island: "[data-hz-key=custom-emojis-page]",
	wide: true,
	steps: [{ waitFor: "text=:party_parrot: >> visible=true" }],
} satisfies ComparePage
