import * as Scene from "foldkit/scene"
import type { Html, HtmlBuilder } from "foldkit/html"
import * as Composer from "../composer/composer"
import * as Draft from "../composer/draft"
import { DragState, DropEvent } from "../composer/drop"
import * as Overlays from "../page/chat/overlays"
import { Message, type Model } from "../page/chat/channel/model"
import {
	loadedMessages,
	loadedModel,
	messages,
	updateWithShared,
} from "../page/chat/channel/fixtures.test-support"
import { view } from "../page/chat/channel/view"
import type { HostRequest } from "@hazel/shared-screens/chat/messages"
import { listRequests } from "../page/chat/channel/list-requests"

/** Scene helpers for the channel page (chat area): config, wrapped Messages, the first-render Mounts. */

type Step = (simulation: Scene.SceneSimulation<Model, Message>) => Scene.SceneSimulation<Model, Message>

export const channelScene = {
	update: updateWithShared,
	view: (model: Model, h: HtmlBuilder<Message>): Html => view(h, model),
}

export const overlays = (message: Overlays.Message) => Message.GotOverlaysMessage({ message })
export const draft = (message: Draft.Message) => Message.GotDraftMessage({ message })
export const composer = (message: Composer.Message) => draft(Draft.Message.GotComposerMessage({ message }))

/** `loadedModel` with its rows derived by update, as the messages query delivers them. */
export const derivedModel = (base: Model = loadedModel()): Model =>
	updateWithShared(base, loadedMessages(base.messages.length === 0 ? messages : base.messages)).model

/** The channel's first render: the editor and the drop zone start (the header is a shared screen). */
export const mountedChannel = (): Step =>
	Scene.Mount.resolveAll(
		[{ name: "MountEditor" }, composer(Composer.Message.UpdatedDraft({ markdown: "", isEmpty: true }))],
		[
			{ name: "TrackFileDrop" },
			draft(
				Draft.Message.ReceivedDropEvent({
					event: DropEvent.ChangedDragState({ drag: DragState.Idle() }),
				}),
			),
		],
	)

/** A row of the shared message list asks the page for something: spread, one step per page message. */
export const listRequest = (request: HostRequest) =>
	listRequests(request).map((message) => Scene.Subscription.emit<Message>(message))
