import { Array, Option, Schema } from "effect"
import { Subscription } from "foldkit"
import type { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { Shared } from "../page/contract"
import type { Resources } from "../rpc"
import type { ModalContext, ModalHost, ModalMessageBase, ModalStep } from "./modal/contract"
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
import { ModalOutMessage } from "./out-message"

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

const Slot = Schema.Union(modals.map((modal) => modal.Slot))
type Slot = typeof Slot.Type

/**
 * The open modal, and the instances that closed (or were replaced) while their Commands may still be
 * running: a late result still delivers its toast and completion, but never touches the open one.
 */
export const Model = Schema.Struct({
	current: Schema.NullOr(Slot),
	/** Newest first, at most `RETIRED_LIMIT`; an instance leaves once it has reported an OutMessage. */
	retired: Schema.Array(Slot),
	/** The number the next opening gets. */
	nextInstance: Schema.Number,
})
export type Model = typeof Model.Type

export const initialModel: Model = { current: null, retired: [], nextInstance: 0 }

export const Message = Schema.Union(modals.map((modal) => modal.Wrapped))
export type Message = typeof Message.Type

export type { ModalContext } from "./modal/contract"

export interface Transition {
	readonly model: Model
	readonly commands?: ReadonlyArray<Command.Command<Message, never, Resources>>
	readonly outMessage: Option.Option<ModalOutMessage>
}

const RETIRED_LIMIT = 8

const settled = (model: Model): Transition => ({ model, outMessage: Option.none() })

const retire = (retired: ReadonlyArray<Slot>, slot: Slot): ReadonlyArray<Slot> =>
	[slot, ...retired.filter((entry) => entry.instance !== slot.instance)].slice(0, RETIRED_LIMIT)

/** Every OutMessage but a toast closes the modal; the root still sees it for the toast and navigation. */
const isClosing = (outMessage: Option.Option<ModalOutMessage>) =>
	Option.match(outMessage, {
		onNone: () => false,
		onSome: ModalOutMessage.match<boolean>({
			Closed: () => true,
			Completed: () => true,
			RequestedToast: () => false,
		}),
	})

/** A step of the open instance: a closing OutMessage retires it. */
const currentStep = (model: Model, step: ModalStep<Slot, Message>): Transition => ({
	model: isClosing(step.outMessage)
		? modifyFields(model, { current: () => null, retired: (retired) => retire(retired, step.slot) })
		: modifyFields(model, { current: () => step.slot }),
	commands: step.commands,
	outMessage: step.outMessage,
})

/** A step of a closed instance: its OutMessage goes to the root, and reporting one ends it. */
const retiredStep = (model: Model, step: ModalStep<Slot, Message>): Transition => ({
	model: modifyFields(model, {
		retired: (retired) =>
			Option.isSome(step.outMessage)
				? retired.filter((entry) => entry.instance !== step.slot.instance)
				: retired.map((entry) => (entry.instance === step.slot.instance ? step.slot : entry)),
	}),
	commands: step.commands,
	outMessage: step.outMessage,
})

/** A registry entry with its own Slot and Message widened to the registry's unions. */
interface RegisteredModal {
	readonly id: string
	readonly init: (
		request: unknown,
		context: ModalContext,
		instance: number,
	) => Option.Option<ModalStep<Slot, Message>>
	readonly update: (
		slot: Slot,
		message: ModalMessageBase,
		context: ModalContext,
	) => Option.Option<ModalStep<Slot, Message>>
}
const registered: ReadonlyArray<RegisteredModal> = modals

const modalById = (id: string) => Array.findFirst(registered, (modal) => modal.id === id)

/** Opening replaces whatever modal is open, like the legacy atoms (one visible at a time). */
export const open = (model: Model, request: ModalRequest, context: ModalContext): Transition => {
	const instance = model.nextInstance
	const opened = modifyFields(model, {
		current: () => null,
		retired: (retired) => (model.current === null ? retired : retire(retired, model.current)),
		nextInstance: () => instance + 1,
	})
	return Option.match(
		Option.flatMap(modalById(request._tag), (modal) => modal.init(request, context, instance)),
		{
			onNone: () => settled(opened),
			onSome: (step) => currentStep(opened, step),
		},
	)
}

/**
 * Routes a Message to the instance that sent it: the open one, or a retired one whose Command
 * finished after it closed. A Subscription's Message (no instance) goes to the open one.
 */
export const update = (model: Model, message: ModalMessageBase, context: ModalContext): Transition => {
	const current = model.current
	const isForCurrent =
		current !== null &&
		current._tag === message._tag &&
		(message.instance === null || message.instance === current.instance)
	if (isForCurrent)
		return Option.match(
			Option.flatMap(modalById(message._tag), (modal) => modal.update(current, message, context)),
			{ onNone: () => settled(model), onSome: (step) => currentStep(model, step) },
		)
	const retired = Array.findFirst(
		model.retired,
		(slot) => slot._tag === message._tag && slot.instance === message.instance,
	)
	return Option.match(
		Option.flatMap(retired, (slot) =>
			Option.flatMap(modalById(message._tag), (modal) => modal.update(slot, message, context)),
		),
		{ onNone: () => settled(model), onSome: (step) => retiredStep(model, step) },
	)
}

export const subscriptions = Subscription.aggregate<ModalHost, Message, Resources>()(
	...modals.map((modal) => modal.subscriptions),
)

export const view = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	shared: Shared,
	toParentMessage: (message: Message) => ParentMessage,
): Html => {
	const current = model.current
	return current === null
		? h.empty
		: Option.match(
				Array.findFirst(modals, (modal) => modal.id === current._tag),
				{
					onNone: () => h.empty,
					onSome: (modal) =>
						h.submodel({
							slotId: `modal:${current._tag}:${current.instance}`,
							model: current,
							view: modal.hostView,
							viewInputs: { shared },
							toParentMessage,
						}),
				},
			)
}
