/** The More tab's links, by route: one module on its own, so a host reads them without the page. */
import { AppRoute, hrefOf } from "../../../app/route"

/** The More tab's rows for `orgSlug`, as every host links them. */
export const moreHrefsOf = (orgSlug: string) => ({
	profile: hrefOf(AppRoute.MySettingsProfile({ orgSlug })),
	customers: hrefOf(AppRoute.CustomersOverview({ orgSlug })),
	members: hrefOf(AppRoute.OrgHome({ orgSlug })),
	invite: hrefOf(AppRoute.SettingsInvitations({ orgSlug })),
	workspaceSettings: hrefOf(AppRoute.SettingsGeneral({ orgSlug })),
	notifications: hrefOf(AppRoute.MySettingsNotifications({ orgSlug })),
	appearance: hrefOf(AppRoute.MySettingsAppearance({ orgSlug })),
	switchWorkspace: hrefOf(AppRoute.SelectOrganization()),
})
