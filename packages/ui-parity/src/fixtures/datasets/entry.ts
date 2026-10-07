import { PublicOrganizationInfo } from "@hazel/domain/rpc"
import type { OrganizationId } from "@hazel/schema"
import type { Dataset, Row } from "../dataset.ts"
import { stableId } from "../ids.ts"
import { defaultDataset, defaultIds } from "./default.ts"

/** Variants of the default workspace for the entry screens (sign-in, join, select organization). */

const now = defaultDataset.now
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)

/** An anonymous visitor. Tables are the default workspace's, but nothing authenticated loads. */
export const signedOutDataset: Dataset = { ...defaultDataset, name: "signed-out", signedOut: true }

/** Ada belongs to three organizations, one still without a slug (setup unfinished). */
const extraOrgs = [
	{ key: "acme", name: "Acme Robotics", slug: "acme", role: "member", joinedDaysAgo: 30 },
	{ key: "orbit", name: "Orbit Studio", slug: null, role: "admin", joinedDaysAgo: 2 },
] as const

const organizations: Row[] = extraOrgs.map((org) => ({
	id: stableId(`org:${org.key}`),
	name: org.name,
	slug: org.slug,
	logoUrl: null,
	settings: null,
	isPublic: org.key === "acme",
	createdAt: daysAgo(org.joinedDaysAgo + 10),
	updatedAt: null,
	deletedAt: null,
}))

const organizationMembers: Row[] = extraOrgs.map((org) => ({
	id: stableId(`org-member:${org.key}:ada`),
	organizationId: stableId(`org:${org.key}`),
	userId: defaultIds.user("ada"),
	role: org.role,
	nickname: null,
	joinedAt: daysAgo(org.joinedDaysAgo),
	invitedBy: null,
	deletedAt: null,
	createdAt: daysAgo(org.joinedDaysAgo),
}))

export const multiOrgDataset: Dataset = {
	...defaultDataset,
	name: "multi-org",
	tables: {
		...defaultDataset.tables,
		organizations: [...(defaultDataset.tables.organizations ?? []), ...organizations],
		organization_members: [...(defaultDataset.tables.organization_members ?? []), ...organizationMembers],
	},
}

/** The organization behind `/join/acme`; every other slug is unknown or not public. */
export const publicOrgSlug = "acme"

export const publicOrganizationBySlug = (payload: unknown) =>
	(payload as { slug: string }).slug === publicOrgSlug
		? new PublicOrganizationInfo({
				id: stableId<OrganizationId>("org:acme"),
				name: "Acme Robotics",
				slug: publicOrgSlug,
				logoUrl: null,
				memberCount: 12,
			})
		: null
