import type { ComparePage } from "../compare-entry"

/** `/hazel/settings/integrations/installed` with the first card asking to confirm its uninstall. */
export default {
	flag: "hazel:native:SettingsIntegrationsInstalled",
	href: "/hazel/settings/integrations/installed",
	island: "[data-hz-key=settings-integrations-installed]",
	wide: true,
	steps: [{ click: "text=Uninstall >> visible=true" }],
} satisfies ComparePage
