import { UserId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Dom, Subscription } from "foldkit"
import type { PageSubscriptionInput } from "../../contract"
import * as DropZone from "../../shared/drop-zone"
import { userRowStream } from "../user-stream"
import { Message } from "./message"
import type { Model } from "./model"
import { interaction, toDropZoneMessage } from "./update"

const isDraggingCrop = (model: Model) => model.crop._tag === "Ready" && model.crop.image.drag !== null

const page = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
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
	// `useCropInteraction`: window listeners while a crop drag is active.
	cropDrag: entry(
		{ isDragging: Schema.Boolean },
		{
			modelToDependencies: ({ model }) => ({ isDragging: isDraggingCrop(model) }),
			dependenciesToStream: ({ isDragging }) =>
				isDragging
					? Stream.merge(
							Dom.streamFromEvent({
								target: window,
								type: "pointermove",
								mapEvent: (event) =>
									Message.MovedCropPointer({
										clientX: event.clientX,
										clientY: event.clientY,
									}),
							}),
							Dom.streamFromEvent({
								target: window,
								type: "pointerup",
								mapEvent: () => Message.ReleasedCropPointer(),
							}),
						)
					: Stream.empty,
		},
	),
	// `useDragDetection`: file drags anywhere on the page, for the "Drop image" hint.
	pageDrag: Subscription.persistentEntry(DropZone.pageDragStream(toDropZoneMessage)),
}))

export const subscriptions = Subscription.aggregate(page, interaction.subscriptions)
