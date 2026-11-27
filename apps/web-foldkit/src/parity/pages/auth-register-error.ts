import type { ComparePage } from "../compare-entry"

/** `/auth/register`: filled in, then refused (the offline API has no registration). */
export default {
	flag: "hazel:native:AuthRegister",
	href: "/auth/register?flowId=flow-1&reference=ref-1",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [{ fill: "input:visible", text: "Ada" }, { click: 'button:visible:has-text("Continue")' }],
} satisfies ComparePage
