import type { ComparePage } from "../compare-entry"

/** Chat: the native channel sidebar docked beside the rail, its org switcher and account card (PH2; the Foldkit sidebar is deleted, so compare it in baseline mode). */
export default {
	flag: "hazel:native:layout:chat",
	tab: "Home",
	href: "/hazel/chat",
	island: '[data-slot="sidebar-container"]',
	wide: true,
	steps: [],
} satisfies ComparePage
