import type { OrganizationId } from "@hazel/schema"
import { eq, type InitialQueryBuilder } from "@tanstack/db"
import { botInstallationCollection } from "~/db/collections"

/** The bots installed in the org and the region each was redeemed in (the Maple card's install). */
export const installationsQuery = (organizationId: OrganizationId) => (q: InitialQueryBuilder) =>
	q
		.from({ installation: botInstallationCollection })
		.where(({ installation }) => eq(installation.organizationId, organizationId))
		.select(({ installation }) => ({ botId: installation.botId, region: installation.region }))
