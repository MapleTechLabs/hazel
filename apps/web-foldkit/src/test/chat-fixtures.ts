import * as Scene from "foldkit/scene"
import type { Html, HtmlBuilder } from "foldkit/html"
import * as Composer from "../composer/composer"
import * as Draft from "../composer/draft"
import { DragState, DropEvent } from "../composer/drop"
import * as MessageList from "../mount/message-list"
import * as Overlays from "../page/chat/overlays"
import * as Menu from "../ui/menu"
import { Message, type Model } from "../page/chat/channel/model"
import {
	loadedMessages,
	loadedModel,
	messages,
	updateWithShared,
} from "../page/chat/channel/fixtures.test-support"
import { view } from "../page/chat/channel/view"
import type { MessageId } from "@hazel/schema"

/** Scene helpers for the channel page (chat area): config, wrapped Messages, the first-render Mounts. */

type Step = (simulation: Scene.SceneSimulation<Model, Message>) => Scene.SceneSimulation<Model, Message>

export const channelScene = {
	update: updateWithShared,
	view: (model: Model, h: HtmlBuilder<Message>): Html => view(h, model),
}

export const VIEWPORT_PX = 600

export const list = (message: MessageList.Message) => Message.GotListMessage({ message })
export const overlays = (message: Overlays.Message) => Message.GotOverlaysMessage({ message })
export const draft = (message: Draft.Message) => Message.GotDraftMessage({ message })
export const composer = (message: Composer.Message) => draft(Draft.Message.GotComposerMessage({ message }))

/** `loadedModel` with its rows derived by update, as the messages query delivers them. */
export const derivedModel = (base: Model = loadedModel()): Model =>
	updateWithShared(base, loadedMessages(base.messages.length === 0 ? messages : base.messages)).model

/** The channel's first render: the list measures its viewport, the editor, drop zone and hover tracker start. */
export const mountedChannel = (hovered: MessageId | null = null): Step =>
	Scene.Mount.resolveAll(
		[
			{ name: "ObserveMessageList" },
			list(MessageList.Message.ResizedViewport({ viewportHeight: VIEWPORT_PX })),
		],
		[{ name: "MountEditor" }, composer(Composer.Message.UpdatedDraft({ markdown: "", isEmpty: true }))],
		[
			{ name: "TrackFileDrop" },
			draft(Draft.Message.ReceivedDropEvent({ event: DropEvent.ChangedDragState({ drag: DragState.Idle() }) })),
		],
		[
			{ name: "TrackMessageHover" },
			hovered === null
				? overlays(Overlays.Message.PointerLeftList())
				: overlays(Overlays.Message.PointerEnteredMessage({ messageId: hovered })),
		],
	)

/** The hover toolbar's Mounts: its placement and the More menu trigger (tooltip triggers have none). */
export const mountedToolbar: Step = Scene.Mount.resolveAll(
	[{ name: "PlaceMessageToolbar" }, overlays(Overlays.Message.EnteredToolbar())],
	[{ name: "FocusTriggerOnPress" }, Menu.Message.CompletedFocusTriggerOnPress()],
)
