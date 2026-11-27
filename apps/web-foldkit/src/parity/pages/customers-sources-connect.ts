import type { ComparePage } from "../compare-entry"

/** Data sources' connect modal for Autumn (not connected). Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:CustomersSettingsSources",
	href: "/hazel/customers/settings/sources",
	island: '[data-hz-key="customers-sources"]',
	wide: true,
	region: "viewport",
	steps: [
		{ waitFor: "text=Signing secret set" },
		{ click: "text=Connect Autumn" },
		{ waitFor: "text=Test and connect" },
	],
} satisfies ComparePage
