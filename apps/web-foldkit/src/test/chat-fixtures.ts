import * as Scene from "foldkit/scene"
import type { Html, HtmlBuilder } from "foldkit/html"
import * as Composer from "../composer/composer"
import * as Draft from "../composer/draft"
import { DropEvent } from "../composer/drop"
import * as MessageList from "../mount/message-list"
import * as Overlays from "../page/chat/overlays"
import * as Tooltip from "../ui/tooltip"
import * as Menu from "../ui/menu"
import { Message, type Model } from "../page/chat/channel/model"
import { loadedModel, messages, updateWithShared } from "../page/chat/channel/fixtures.test-support"
import { view } from "../page/chat/channel/view"
import type { MessageId } from "@hazel/schema"

/** Scene helpers for the channel page (chat area): config, wrapped Messages, the first-render Mounts. */

type Step = (simulation: Scene.SceneSimulation<Model, Message>) => Scene.SceneSimulation<Model, Message>

const toSelf = (message: Message) => message

export const channelScene = {
	update: updateWithShared,
	view: (model: Model, h: HtmlBuilder<Message>): Html => view(h, model, toSelf),
}

export const VIEWPORT_PX = 600

export const list = (message: MessageList.Message) => Message.GotListMessage({ message })
export const overlays = (message: Overlays.Message) => Message.GotOverlaysMessage({ message })
export const draft = (message: Draft.Message) => Message.GotDraftMessage({ message })
export const composer = (message: Composer.Message) =>
	draft(Draft.Message.GotComposerMessage({ message }))

/** `loadedModel` with its rows derived by update, as the messages query delivers them. */
export const derivedModel = (base: Model = loadedModel()): Model =>
	updateWithShared(base, Message.UpdatedMessages({ messages: base.messages.length === 0 ? messages : base.messages })).model

/** Runs steps in order (Scene has no `steps` grouping helper). */
export const sequence =
	(...steps: ReadonlyArray<Step>): Step =>
	(simulation) =>
		steps.reduce((current, step) => step(current), simulation)

/** The channel's first render: the list measures its viewport, the editor, drop zone and hover tracker start. */
export const mountedChannel = (hovered: MessageId | null = null): Step =>
	Scene.Mount.resolveAll(
		[{ name: "ObserveMessageList" }, list(MessageList.Message.ResizedViewport({ viewportHeight: VIEWPORT_PX }))],
		[{ name: "MountEditor" }, composer(Composer.Message.UpdatedDraft({ markdown: "", isEmpty: true }))],
		[
			{ name: "TrackFileDrop" },
			draft(Draft.Message.GotDropEvent({ event: DropEvent.ChangedDragState({ isDraggingOnPage: false, isDropTarget: false }) })),
		],
		[
			{ name: "TrackMessageHover" },
			hovered === null
				? overlays(Overlays.Message.PointerLeftList())
				: overlays(Overlays.Message.PointerEnteredMessage({ messageId: hovered })),
		],
	)

/** Three quick reactions, Add reaction, Copy and Reply, plus Edit and Delete on one's own message. */
const toolbarTooltips = (isOwnMessage: boolean) => (isOwnMessage ? 8 : 6)

/** The hover toolbar's Mounts: its placement, one tooltip trigger per button and the More menu trigger. */
const tooltipTrigger = (): readonly [{ readonly name: string }, Tooltip.Message] => [
	{ name: "TrackTooltipTrigger" },
	Tooltip.Message.CompletedTrackTrigger(),
]

export const mountedToolbar = (isOwnMessage: boolean): Step =>
	Scene.Mount.resolveAll(
		[{ name: "PlaceMessageToolbar" }, overlays(Overlays.Message.EnteredToolbar())],
		...Array.from({ length: toolbarTooltips(isOwnMessage) }, tooltipTrigger),
		[{ name: "FocusTriggerOnPress" }, Menu.Message.CompletedFocusTriggerOnPress()],
	)
