import * as Scene from "foldkit/scene"
import type { Html, HtmlBuilder } from "foldkit/html"
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

/** `loadedModel` with its rows derived by update, as the messages query delivers them. */
export const derivedModel = (base: Model = loadedModel()): Model =>
	updateWithShared(base, loadedMessages(base.messages.length === 0 ? messages : base.messages)).model

/** The channel's first render: nothing to resolve (the header, list and composer are shared screens). */
export const mountedChannel = (): Step => (simulation) => simulation

/** A row of the shared message list asks the page for something: spread, one step per page message. */
export const listRequest = (request: HostRequest) =>
	listRequests(request).map((message) => Scene.Subscription.emit<Message>(message))
