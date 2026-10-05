"use client"

import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import type { OrganizationId } from "@hazel/schema"
import { memo } from "react"
import { customEmojisForOrgAtomFamily } from "~/atoms/custom-emoji-atoms"
import { formatCustomEmojiKey } from "~/lib/custom-emoji-utils"
import { cn } from "~/lib/utils"

interface CustomEmojiSectionProps {
	organizationId: OrganizationId
	searchQuery: string
	onEmojiSelect: (emoji: { emoji: string; label: string; imageUrl?: string }) => void
}

export const CustomEmojiSection = memo(function CustomEmojiSection({
	organizationId,
	searchQuery,
	onEmojiSelect,
}: CustomEmojiSectionProps) {
	const emojisResult = useAtomValue(customEmojisForOrgAtomFamily(organizationId))
	const emojis = AsyncResult.getOrElse(emojisResult, () => [])

	if (emojis.length === 0) return null

	// Filter by search query
	const filtered = searchQuery
		? emojis.filter((e) => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
		: emojis

	if (filtered.length === 0) return null

	return (
		<div className="border-border border-t">
			<div
				className="bg-bg px-3 pt-4 pb-2.5 font-medium text-secondary-fg text-sm leading-none"
				data-slot="emoji-picker-category-header"
			>
				Custom
			</div>
			<div className="grid grid-cols-9 gap-0 px-2 pb-2">
				{filtered.map((emoji) => (
					<button
						key={emoji.id}
						type="button"
						onClick={() =>
							onEmojiSelect({
								emoji: formatCustomEmojiKey(emoji.name),
								label: emoji.name,
								imageUrl: emoji.imageUrl,
							})
						}
						className={cn("flex size-10 items-center justify-center rounded-md hover:bg-accent")}
						title={`:${emoji.name}:`}
					>
						<img src={emoji.imageUrl} alt={emoji.name} className="size-7 object-contain" />
					</button>
				))}
			</div>
		</div>
	)
})
