import { Array, Option, Schema } from "effect"
import { Subscription } from "foldkit"
import type { Command } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { Shared } from "../page/contract"
import type { HazelRpc } from "../rpc"
import type { ModalHost, ModalMessageBase, ModalSlotBase, ModalStep } from "./modal/contract"
import * as ChangeRole from "./modal/change-role"
import * as CreateBot from "./modal/create-bot"
import * as CreateDm from "./modal/create-dm"
import * as CreateOrganization from "./modal/create-organization"
import * as CreateSection from "./modal/create-section"
import * as DeleteChannel from "./modal/delete-channel"
import * as DeleteMessage from "./modal/delete-message"
import * as DeleteBot from "./modal/delete-bot"
import * as DeleteWorkspace from "./modal/delete-workspace"
import * as EditBot from "./modal/edit-bot"
import * as EmailInvite from "./modal/email-invite"
import * as Feedback from "./modal/feedback"
import * as InstallBotById from "./modal/install-bot-by-id"
import * as JoinChannel from "./modal/join-channel"
import * as NewChannel from "./modal/new-channel"
import * as RegenerateBotToken from "./modal/regenerate-bot-token"
import * as RenameChannel from "./modal/rename-channel"
import * as RenameThread from "./modal/rename-thread"
import * as RequestIntegration from "./modal/request-integration"
import * as SetStatus from "./modal/set-status"
import type { ModalRequest } from "./modal/requests"
import type { ModalOutMessage } from "./out-message"

/**
 * Root modal slot (legacy `atoms/modal-atoms`, the global modals in `$orgSlug/layout.tsx`, and the
 * page-local modals). Pages and the shell open one with `RequestedModal`; at most one is open.
 */
const modals = [
	NewChannel.modal,
	CreateDm.modal,
	JoinChannel.modal,
	EmailInvite.modal,
	CreateOrganization.modal,
	CreateSection.modal,
	DeleteChannel.modal,
	Feedback.modal,
	SetStatus.modal,
	RenameChannel.modal,
	RenameThread.modal,
	ChangeRole.modal,
	DeleteWorkspace.modal,
	RequestIntegration.modal,
	CreateBot.modal,
	EditBot.modal,
	InstallBotById.modal,
	RegenerateBotToken.modal,
	DeleteBot.modal,
	DeleteMessage.modal,
]

/** What a page or the shell asks for. One variant per legacy modal. */
export { ModalRequest } from "./modal/requests"

export const Model = Schema.NullOr(Schema.Union(modals.map((modal) => modal.Slot)))
export type Model = typeof Model.Type

export const Message = Schema.Union(modals.map((modal) => modal.Wrapped))
export type Message = typeof Message.Type

export interface Transition {
	readonly model: Model
	readonly commands?: ReadonlyArray<Command.Command<Message, never, HazelRpc>>
	readonly outMessage: Option.Option<ModalOutMessage>
}

type Slot = NonNullable<Model>

const settled = (model: Model): Transition => ({ model, outMessage: Option.none() })

/** A closing OutMessage drops the slot; the root still sees it for the toast and navigation. */
const toTransition = (found: Option.Option<ModalStep<Slot, Message>>, fallback: Model): Transition =>
	Option.match(found, {
		onNone: () => settled(fallback),
		onSome: (step) => ({
			model: Option.match(step.outMessage, {
				onNone: () => step.slot,
				onSome: (outMessage) => (outMessage._tag === "RequestedToast" ? step.slot : null),
			}),
			commands: step.commands,
			outMessage: step.outMessage,
		}),
	})

const modalById = (id: string) => Array.findFirst(modals, (modal) => modal.id === id)

/** Opening replaces whatever modal is open, like the legacy atoms (one visible at a time). */
export const open = (_model: Model, request: ModalRequest, shared: Shared): Transition =>
	Option.match(modalById(request._tag), {
		onNone: () => settled(null),
		onSome: (modal) => toTransition(modal.init(request, shared), null),
	})

export const update = (model: Model, message: ModalMessageBase, shared: Shared): Transition =>
	model === null
		? settled(model)
		: Option.match(modalById(message._tag), {
				onNone: () => settled(model),
				onSome: (modal) => toTransition(modal.update(model, message, shared), model),
			})

export const subscriptions = Subscription.aggregate<ModalHost, Message, HazelRpc>()(
	...modals.map((modal) => modal.subscriptions),
)

export const view = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: ModalSlotBase | null,
	shared: Shared,
	toParentMessage: (message: Message) => ParentMessage,
): Html =>
	model === null
		? h.empty
		: Option.match(modalById(model._tag), {
				onNone: () => h.empty,
				onSome: (modal) =>
					h.submodel({
						slotId: `modal:${model._tag}`,
						model,
						view: modal.hostView,
						viewInputs: { shared },
						toParentMessage,
					}),
			})
