import type { ComparePage } from "../compare-entry"

/** Channel settings: the native header and tabs around Overview (PH1; the Foldkit layout is deleted, so compare it in baseline mode). */
export default {
	flag: "hazel:native:layout:channelSettings",
	href: "/hazel/channels/00000005-0000-4000-8000-000000000001/settings/overview",
	island: '[data-section-layout="channelSettings"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
