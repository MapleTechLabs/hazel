"use client"

import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import type { OrganizationId } from "@hazel/schema"
import { useMemo } from "react"
import { customEmojisForOrgAtomFamily } from "~/atoms/custom-emoji-atoms"
import { formatCustomEmojiKey } from "~/lib/custom-emoji-utils"
import { EMOJI_DATA } from "~/lib/emoji-shortcode-map"
import { AutocompleteListBox } from "../autocomplete-listbox"
import type { AutocompleteOption, AutocompleteState, EmojiData } from "../types"

/**
 * Build searchable emoji options
 */
function buildEmojiOptions(): AutocompleteOption<EmojiData>[] {
	return EMOJI_DATA.map(([emoji, name, ...keywords]) => ({
		id: name,
		label: `${emoji} :${name}:`,
		data: {
			id: name,
			emoji,
			name,
			keywords,
		},
	}))
}

const ALL_EMOJI_OPTIONS = buildEmojiOptions()

interface EmojiTriggerProps {
	/** Items to display */
	items: AutocompleteOption<EmojiData>[]
	/** Currently active index */
	activeIndex: number
	/** Callback when an item is selected */
	onSelect: (index: number) => void
	/** Callback when mouse hovers over an item */
	onHover: (index: number) => void
	/** Current search length for empty message */
	searchLength: number
}

/**
 * Emoji trigger component
 * Renders emoji suggestions using simple index-based focus
 */
export function EmojiTrigger({ items, activeIndex, onSelect, onHover, searchLength }: EmojiTriggerProps) {
	return (
		<AutocompleteListBox
			items={items}
			activeIndex={activeIndex}
			onSelect={onSelect}
			onHover={onHover}
			emptyMessage={searchLength < 2 ? "Type at least 2 characters" : "No emoji found"}
			renderItem={({ option }) => <EmojiItem option={option} />}
		/>
	)
}

function EmojiItem({ option }: { option: AutocompleteOption<EmojiData> }) {
	return (
		<div className="flex items-center gap-2">
			{option.data.imageUrl ? (
				<img src={option.data.imageUrl} alt={option.data.name} className="size-5 object-contain" />
			) : (
				<span className="text-xl">{option.data.emoji}</span>
			)}
			<span className="text-muted-fg">:{option.data.name}:</span>
		</div>
	)
}

/**
 * Hook to get custom emoji options from the org's custom emoji list.
 * Separated to avoid subscribing all editors without custom emojis to the atom.
 */
function useCustomEmojiOptions(organizationId: OrganizationId | undefined): AutocompleteOption<EmojiData>[] {
	const emojisResult = useAtomValue(customEmojisForOrgAtomFamily(organizationId ?? ("" as OrganizationId)))
	const emojis = AsyncResult.getOrElse(emojisResult, () => [])

	return useMemo(() => {
		if (!organizationId || emojis.length === 0) return []
		return emojis.map((emoji) => ({
			id: formatCustomEmojiKey(emoji.name),
			label: `:${emoji.name}:`,
			data: {
				id: formatCustomEmojiKey(emoji.name),
				emoji: formatCustomEmojiKey(emoji.name),
				name: emoji.name,
				imageUrl: emoji.imageUrl,
			},
		}))
	}, [organizationId, emojis])
}

/**
 * Get emoji options for external use
 */
export function useEmojiOptions(
	state: AutocompleteState,
	organizationId?: OrganizationId,
): AutocompleteOption<EmojiData>[] {
	const customOptions = useCustomEmojiOptions(organizationId)

	return useMemo(() => {
		const search = state.search.toLowerCase()
		if (search.length < 2) return []

		const standardResults = ALL_EMOJI_OPTIONS.filter((option) => {
			const { name, keywords } = option.data
			if (name.includes(search)) return true
			if (keywords?.some((kw) => kw.includes(search))) return true
			return false
		})

		const customResults = customOptions.filter((option) => option.data.name.includes(search))

		// Custom emojis first, then standard
		return [...customResults, ...standardResults].slice(0, 20)
	}, [state.search, customOptions])
}
