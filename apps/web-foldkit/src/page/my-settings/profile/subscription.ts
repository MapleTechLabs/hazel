import { UserId } from "@hazel/schema"
import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import type { PageSubscriptionInput } from "../../contract"
import { userRowStream } from "../user"
import { Message } from "./message"
import type { Model } from "./model"
import { interaction } from "./update"

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false

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
							Subscription.fromEvent({
								target: window,
								type: "pointermove",
								mapEvent: (event) =>
									Message.MovedCropPointer({
										clientX: event.clientX,
										clientY: event.clientY,
									}),
							}),
							Subscription.fromEvent({
								target: window,
								type: "pointerup",
								mapEvent: () => Message.ReleasedCropPointer(),
							}),
						)
					: Stream.empty,
		},
	),
	// `useDragDetection`: file drags anywhere on the page.
	pageDrag: Subscription.persistent(
		Stream.mergeAll(
			[
				Subscription.fromEventFilterMap({
					target: document,
					type: "dragenter",
					filterMapEvent: (event) =>
						hasFiles(event)
							? Option.some(Message.DraggedFilesOverPage({ isEntering: true }))
							: Option.none(),
				}),
				Subscription.fromEvent({
					target: document,
					type: "dragleave",
					mapEvent: () => Message.DraggedFilesOverPage({ isEntering: false }),
				}),
				Subscription.fromEvent({
					target: document,
					type: "drop",
					mapEvent: () => Message.EndedPageDrag(),
				}),
				Subscription.fromEvent({
					target: document,
					type: "dragend",
					mapEvent: () => Message.EndedPageDrag(),
				}),
			],
			{ concurrency: "unbounded" },
		),
	),
}))

export const subscriptions = Subscription.aggregate(page, interaction.subscriptions)
