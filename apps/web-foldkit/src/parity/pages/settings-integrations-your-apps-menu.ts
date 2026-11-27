import type { ComparePage } from "../compare-entry"

/** `/hazel/settings/integrations/your-apps` with the first bot's actions menu open. */
export default {
	flag: "hazel:native:SettingsIntegrationsYourApps",
	href: "/hazel/settings/integrations/your-apps",
	island: "[data-hz-key=settings-integrations-your-apps]",
	wide: true,
	region: "viewport",
	steps: [{ click: '[aria-label="Bot actions"] >> visible=true' }],
} satisfies ComparePage
