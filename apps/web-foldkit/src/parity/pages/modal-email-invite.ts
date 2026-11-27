import type { ComparePage } from "../compare-entry"

/** Invite people: Mod+Alt+I (a phone's switcher has no Invite people), an address typed. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:EmailInvite",
	href: "/hazel/chat",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ press: "ControlOrMeta+Alt+i" },
		{ fill: 'input[placeholder="colleague@company.com"]', text: "grace@hazel.test" },
	],
} satisfies ComparePage
