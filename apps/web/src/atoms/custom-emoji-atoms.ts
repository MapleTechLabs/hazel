import { Atom, AsyncResult } from "effect/reactivity"
import type { OrganizationId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { customEmojiCollection } from "~/db/collections"
import { formatCustomEmojiKey } from "~/lib/custom-emoji-utils"
import { makeQuery } from "../../../../libs/tanstack-db-atom/src"

/**
 * Atom family for fetching all non-deleted custom emojis for an organization.
 * Automatically deduplicates across components.
 */
export const customEmojisForOrgAtomFamily = Atom.family((orgId: OrganizationId) =>
	makeQuery((q) =>
		q
			.from({ emoji: customEmojiCollection })
			.where((q) => and(eq(q.emoji.organizationId, orgId), isNull(q.emoji.deletedAt))),
	),
)

/**
 * Derived atom that builds a Map<"custom:name", { name, imageUrl }> for fast lookup.
 * Used by reaction rendering and emoji resolution.
 */
export const customEmojiMapAtomFamily = Atom.family((orgId: OrganizationId) =>
	Atom.make((get) => {
		const emojisResult = get(customEmojisForOrgAtomFamily(orgId))
		const emojis = AsyncResult.getOrElse(emojisResult, () => [])

		const map = new Map<string, { name: string; imageUrl: string }>()
		for (const emoji of emojis) {
			map.set(formatCustomEmojiKey(emoji.name), { name: emoji.name, imageUrl: emoji.imageUrl })
		}
		return map
	}),
)
