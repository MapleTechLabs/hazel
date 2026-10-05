import type { ChannelId, OrganizationId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { useMemo } from "react"
import { connectConversationChannelCollection, organizationCollection } from "~/db/collections"
import { getSharedChannelIds } from "~/lib/connect-shared-channels"

export type PartnerOrgInfo = {
	id: OrganizationId
	name: string
	slug: string | null
	logoUrl: string | null
}

/**
 * Returns a Map of channel IDs to their partner org info for channels
 * that are part of active Hazel Connect conversations.
 */
export function useSharedChannels(currentOrgId: OrganizationId | undefined) {
	const { data: mounts } = useLiveQuery({
		query: (q) =>
			q
				.from({ ccc: connectConversationChannelCollection })
				.where(({ ccc }) => eq(ccc.isActive, true))
				.select(({ ccc }) => ({
					channelId: ccc.channelId,
					conversationId: ccc.conversationId,
					organizationId: ccc.organizationId,
					isActive: ccc.isActive,
					deletedAt: ccc.deletedAt,
				})),
		queryKey: [],
	})

	const { data: orgs } = useLiveQuery({
		query: (q) =>
			q.from({ org: organizationCollection }).select(({ org }) => ({
				id: org.id,
				name: org.name,
				slug: org.slug,
				logoUrl: org.logoUrl,
			})),
		queryKey: [],
	})

	return useMemo(() => {
		const result = new Map<ChannelId, PartnerOrgInfo[]>()
		if (!mounts || !currentOrgId) return result

		const sharedChannelIds = getSharedChannelIds(mounts as Parameters<typeof getSharedChannelIds>[0])

		// Build org lookup
		const orgMap = new Map<string, PartnerOrgInfo>()
		for (const org of orgs ?? []) {
			orgMap.set(org.id, {
				id: org.id as OrganizationId,
				name: org.name,
				slug: org.slug,
				logoUrl: org.logoUrl,
			})
		}

		// Group mounts by conversationId for shared channels
		const conversationMounts = new Map<string, typeof mounts>()
		for (const mount of mounts) {
			if (!sharedChannelIds.has(mount.channelId as ChannelId)) continue
			const existing = conversationMounts.get(mount.conversationId) ?? []
			existing.push(mount)
			conversationMounts.set(mount.conversationId, existing)
		}

		// For each shared channel, find partner orgs
		for (const mount of mounts) {
			if (!sharedChannelIds.has(mount.channelId as ChannelId)) continue
			if (mount.organizationId !== currentOrgId) continue

			const allMounts = conversationMounts.get(mount.conversationId) ?? []
			const partners: PartnerOrgInfo[] = []
			for (const other of allMounts) {
				if (other.organizationId === currentOrgId) continue
				const org = orgMap.get(other.organizationId)
				if (org && !partners.some((p) => p.id === org.id)) {
					partners.push(org)
				}
			}
			if (partners.length > 0) {
				result.set(mount.channelId as ChannelId, partners)
			}
		}

		return result
	}, [mounts, orgs, currentOrgId])
}
