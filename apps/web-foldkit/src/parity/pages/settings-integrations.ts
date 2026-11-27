import type { ComparePage } from "../compare-entry"

/** `/hazel/settings/integrations`: every integration, Linear and GitHub connected. */
export default {
	flag: "hazel:native:SettingsIntegrations",
	href: "/hazel/settings/integrations",
	island: "[data-hz-key=settings-integrations]",
	wide: true,
	steps: [],
} satisfies ComparePage
