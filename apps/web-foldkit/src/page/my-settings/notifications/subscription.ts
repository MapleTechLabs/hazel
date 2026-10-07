import { UserId } from "@hazel/schema"
import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import * as Slider from "../../../ui/slider"
import type { PageSubscriptionInput } from "../../contract"
import { userRowStream } from "../user"
import { Message } from "./message"
import type { Model } from "./model"
import { interaction, toVolumeMessage } from "./update"

const userRow = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	userRow: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({ userId: shared.currentUser?.id ?? null }),
			dependenciesToStream: ({ userId }) =>
				userId === null ? Stream.empty : userRowStream(userId, (row) => Message.UpdatedUserRow({ row })),
		},
	),
}))

const volume = Subscription.lift(Slider.subscriptions)<PageSubscriptionInput<Model>, Message>({
	read: (input) => Option.some(input.model.volume),
	toParentMessage: toVolumeMessage,
})

export const subscriptions = Subscription.aggregate(userRow, volume, interaction.subscriptions)
