import { Option, Schema } from "effect"
import { Command, Submodel, Subscription, type Update } from "foldkit"
import type { Shared } from "../../page/contract"
import type { AppRoute } from "../../route"
import type { Resources } from "../../rpc"
import type { ModalOutMessage } from "../out-message"

/**
 * The modal contract: each legacy `useModal` id (and each page-local modal) is a Submodel the root
 * opens from a `RequestedModal`. Mirrors `page/contract.ts`: registered once in `overlay/modal.ts`.
 *
 * Every opening is a new instance with its own number. Slots and Messages carry it, so a Command's
 * result reaches the instance that issued it, even after that one closed or another replaced it.
 */

/** What `init` and `update` see: the shared state plus the route the modal opened over. */
export interface ModalContext extends Shared {
	readonly route: AppRoute
}

export interface ModalViewInputs {
	readonly shared: Shared
}

export interface ModalSubscriptionInput<Model> {
	readonly model: Model
	readonly shared: Shared
}

export type ModalReturn<Model, Message> = Update.ReturnWithOutMessage<
	Model,
	Message,
	ModalOutMessage,
	Resources
>

export interface ModalSpec<Request, Model, Message> {
	readonly init: (request: Request, context: ModalContext) => ModalReturn<Model, Message>
	readonly update: (model: Model, message: Message, context: ModalContext) => ModalReturn<Model, Message>
	readonly view: Submodel.View<Model, Message, ModalViewInputs>
	readonly subscriptions?: Subscription.Subscriptions<ModalSubscriptionInput<Model>, Message, Resources>
}

export interface ModalSlotBase {
	readonly _tag: string
	readonly instance: number
}
export interface ModalMessageBase {
	readonly _tag: string
	/** The instance that sent it; `null` from a Subscription, which always follows the open instance. */
	readonly instance: number | null
}
export interface ModalHost {
	readonly modal: { readonly current: ModalSlotBase | null }
	readonly shared: Shared
}

export interface ModalStep<Slot, Wrapped> {
	readonly slot: Slot
	readonly commands: ReadonlyArray<Command.Command<Wrapped, never, Resources>>
	readonly outMessage: Option.Option<ModalOutMessage>
}

/**
 * Request `{ _tag: id, ...fields }` (from `requests.ts`), slot `{ _tag: id, instance, model }`, Messages
 * `{ _tag: id, instance, message }`. The request schema comes from `requests.ts`, so out-messages stay
 * free of modal views.
 */
export const defineModal = <
	const Id extends string,
	RequestSchema extends Schema.Top & { readonly Type: { readonly _tag: Id } },
	ModelSchema extends Schema.Top,
	MessageSchema extends Schema.Top,
>(
	id: Id,
	schemas: {
		readonly request: RequestSchema
		readonly Model: ModelSchema
		readonly Message: MessageSchema
	},
	spec: ModalSpec<RequestSchema["Type"], ModelSchema["Type"], MessageSchema["Type"]>,
) => {
	type Model = ModelSchema["Type"]
	type Message = MessageSchema["Type"]
	const Slot = Schema.TaggedStruct(id, { instance: Schema.Number, model: schemas.Model })
	const Wrapped = Schema.TaggedStruct(id, {
		instance: Schema.NullOr(Schema.Number),
		message: schemas.Message,
	})
	type SlotType = { readonly _tag: Id; readonly instance: number; readonly model: Model }
	type WrappedType = { readonly _tag: Id; readonly instance: number | null; readonly message: Message }

	// The tags are unique across the registry, so a matching tag is this modal's value.
	const isOwnRequest = Schema.is(schemas.request)
	const isOwnSlot = (slot: ModalSlotBase): slot is SlotType => slot._tag === id
	const isOwnMessage = (message: ModalMessageBase): message is WrappedType => message._tag === id
	const wrapFor =
		(instance: number | null) =>
		(message: Message): WrappedType => ({ _tag: id, instance, message })
	const step = (
		instance: number,
		result: ModalReturn<Model, Message>,
	): ModalStep<SlotType, WrappedType> => ({
		slot: { _tag: id, instance, model: result.model },
		commands: Command.mapMessages(result.commands, wrapFor(instance)),
		outMessage: Option.fromNullishOr(result.outMessage),
	})

	const lifted = Subscription.lift(spec.subscriptions ?? {})<ModalHost, WrappedType>({
		read: (host) =>
			host.modal.current !== null && isOwnSlot(host.modal.current)
				? Option.some({ model: host.modal.current.model, shared: host.shared })
				: Option.none(),
		toParentMessage: wrapFor(null),
	})

	return {
		id,
		Request: schemas.request,
		Slot,
		Wrapped,
		init: (request: unknown, context: ModalContext, instance: number) =>
			isOwnRequest(request)
				? Option.some(step(instance, spec.init(request, context)))
				: Option.none<ModalStep<SlotType, WrappedType>>(),
		/** Runs `message` on `slot`; the caller has already picked the slot by the message's instance. */
		update: (slot: ModalSlotBase, message: ModalMessageBase, context: ModalContext) =>
			isOwnSlot(slot) && isOwnMessage(message)
				? Option.some(step(slot.instance, spec.update(slot.model, message.message, context)))
				: Option.none<ModalStep<SlotType, WrappedType>>(),
		hostView: Submodel.defineView<ModalSlotBase, WrappedType, ModalViewInputs>((slot, inputs, h) =>
			isOwnSlot(slot)
				? h.submodel({
						slotId: `modal:${id}:${slot.instance}`,
						model: slot.model,
						view: spec.view,
						viewInputs: inputs,
						toParentMessage: wrapFor(slot.instance),
					})
				: h.empty,
		),
		/** Keys are prefixed with the modal id: Subscription keys share one namespace. */
		subscriptions: Object.fromEntries(
			Object.entries(lifted).map(([key, entry]) => [`modal.${id}.${key}`, entry]),
		),
	}
}
