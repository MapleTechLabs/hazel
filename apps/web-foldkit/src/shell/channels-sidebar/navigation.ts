import type { ChannelId } from "@hazel/schema"
import type { Model } from "./model"

/**
 * Discord's Alt+ArrowUp / Alt+ArrowDown (and with Shift, unread channels only): the sidebar's
 * channels in the order it shows them, favorites first, then the default section, the custom
 * sections, and the direct messages. A favorite listed again in its section is visited once.
 */
export const navigationOrder = (model: Model): ReadonlyArray<ChannelId> => {
	const ids = [
		...model.favorites.map((entry) => entry.channel.id),
		...(model.sectionChannels["default"] ?? []).map((entry) => entry.channel.id),
		...model.sections.flatMap((section) =>
			(model.sectionChannels[section.id] ?? []).map((entry) => entry.channel.id),
		),
		...model.dmChannelIds.filter((channelId) => model.dmChannels[channelId] != null),
	]
	return [...new Set(ids)]
}

export type Direction = "Previous" | "Next"

/**
 * The channel one step from `current`, wrapping at either end as Discord does; with `unreadOnly`, the
 * nearest one with unread messages. From a page that is not in the list (or none), Next starts at the
 * top and Previous at the bottom. `null` when there is nowhere to go.
 */
export const adjacentChannel = (
	model: Model,
	current: ChannelId | null,
	direction: Direction,
	unreadOnly: boolean,
): ChannelId | null => {
	const order = navigationOrder(model)
	if (order.length === 0) return null
	const unread = new Set(
		model.unreadCounts.filter(({ count }) => count > 0).map(({ channelId }) => channelId),
	)
	const step = direction === "Next" ? 1 : -1
	const index = current === null ? -1 : order.indexOf(current)
	const start = index === -1 ? (direction === "Next" ? -1 : order.length) : index
	for (let offset = 1; offset <= order.length; offset++) {
		const candidate = order.at((start + step * offset) % order.length)
		if (candidate === undefined || candidate === current) return null
		if (!unreadOnly || unread.has(candidate)) return candidate
	}
	return null
}
