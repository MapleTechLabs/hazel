import type { ComparePage } from "../compare-entry"

/** `/`: a loader that redirects at once, so this compares where each side lands (Ada's org home). */
export default {
	flag: "hazel:native:Root",
	href: "/",
	island: '[data-paint="shell"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
