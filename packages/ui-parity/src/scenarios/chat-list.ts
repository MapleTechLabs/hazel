import { heavyDataset, heavyIds } from "../fixtures/datasets/heavy.ts"
import type { AreaModule } from "./types.ts"

const heavyChat = (channelId: string) => `/${heavyIds.orgSlug}/chat/${channelId}`

/** Message list and sidebar at scale: 500 channels, a 10,000-message channel. */
export const chatListArea: AreaModule = {
	datasets: [heavyDataset],
	scenarios: [
		{
			id: "chat-heavy-channel",
			area: "chat-list",
			title: "10,000-message channel in a 500-channel workspace",
			path: heavyChat(heavyIds.bigChannelId),
			dataset: heavyDataset.name,
			themes: ["light", "dark"],
		},
		{
			id: "chat-heavy-small-channel",
			area: "chat-list",
			title: "Normal channel in a 500-channel workspace",
			path: heavyChat(heavyIds.smallChannelId),
			dataset: heavyDataset.name,
		},
	],
}
