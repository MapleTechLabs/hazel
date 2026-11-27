import type { ComparePage } from "../compare-entry"

/** My settings: the same layout around Profile (PH1; the Foldkit layout is deleted, so compare it in baseline mode). */
export default {
	flag: "hazel:native:layout:settings",
	href: "/hazel/my-settings/profile",
	island: '[data-section-layout="settings"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
