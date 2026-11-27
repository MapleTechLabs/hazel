import type { ComparePage } from "../compare-entry"

/** `/auth/register`: Continue with no first name shows the field's error. */
export default {
	flag: "hazel:native:AuthRegister",
	href: "/auth/register?flowId=flow-1&reference=ref-1",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [{ click: 'button:visible:has-text("Continue")' }],
} satisfies ComparePage
