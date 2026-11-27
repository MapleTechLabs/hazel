import type { ComparePage } from "../compare-entry"

/** Settings (and my settings): the native sidebar and content column around General (PH1; the Foldkit layout is deleted, so compare it in baseline mode). */
export default {
	flag: "hazel:native:layout:settings",
	href: "/hazel/settings",
	island: '[data-section-layout="settings"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
