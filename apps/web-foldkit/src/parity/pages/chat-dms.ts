import type { ComparePage } from "../compare-entry"

/** `/hazel/chat/dms`: the cards page wide, the phone's DMs tab (the shared DMs screen) at 390. */
export default {
	flag: "hazel:native:ChatDms",
	tab: "DMs",
	href: "/hazel/chat/dms",
	island: "[data-hz-key=chat-dms], [data-hz-key=filters]",
	wide: true,
	steps: [],
} satisfies ComparePage
