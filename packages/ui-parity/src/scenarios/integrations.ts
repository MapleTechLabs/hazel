import { org, type AreaModule } from "./types.ts"

export const integrationsArea: AreaModule = {
	scenarios: [
		{
			id: "settings-integrations",
			area: "settings",
			title: "Integrations",
			path: `${org}/settings/integrations`,
		},
	],
}
