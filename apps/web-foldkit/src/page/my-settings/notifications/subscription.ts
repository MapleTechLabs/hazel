import { OrganizationId, UserId } from "@hazel/schema"
import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import * as Slider from "../../../ui/slider"
import type { PageSubscriptionInput } from "../../contract"
import { userRowStream } from "../user-stream"
import { Message } from "./message"
import { organizationSettingsStream } from "./organization"
import type { Model } from "./model"
import { interaction, toVolumeMessage } from "./update"

const userRow = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	userRow: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({ userId: shared.currentUser?.id ?? null }),
			dependenciesToStream: ({ userId }) =>
				userId === null
					? Stream.empty
					: userRowStream(userId, (row) => Message.UpdatedUserRow({ row })),
		},
	),
}))

const organizationSettings = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	organizationNotificationSettings: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({ organizationId: shared.organization?.id ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: organizationSettingsStream(organizationId, (settings) =>
							Message.UpdatedOrganizationSettings({ settings }),
						),
		},
	),
}))

const volume = Subscription.lift(Slider.subscriptions)<PageSubscriptionInput<Model>, Message>({
	read: (input) => Option.some(input.model.volume),
	toParentMessage: toVolumeMessage,
})

export const subscriptions = Subscription.aggregate(
	userRow,
	organizationSettings,
	volume,
	interaction.subscriptions,
)
