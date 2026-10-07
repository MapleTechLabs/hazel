import { Option, Schema } from "effect"
import { Command, Submodel, Subscription, type Update } from "foldkit"
import type { Shared } from "../../page/contract"
import type { HazelRpc } from "../../rpc"
import type { ModalOutMessage } from "../out-message"

/**
 * The modal contract: each legacy `useModal` id (and each page-local modal) is a Submodel the root
 * opens from a `RequestedModal`. Mirrors `page/contract.ts`: registered once in `overlay/modal.ts`.
 */

export interface ModalViewInputs {
	readonly shared: Shared
}

export interface ModalSubscriptionInput<Model> {
	readonly model: Model
	readonly shared: Shared
}

export type ModalReturn<Model, Message> = Update.ReturnWithOutMessage<Model, Message, ModalOutMessage, HazelRpc>

export interface ModalSpec<Request, Model, Message> {
	readonly init: (request: Request, shared: Shared) => ModalReturn<Model, Message>
	readonly update: (model: Model, message: Message, shared: Shared) => ModalReturn<Model, Message>
	readonly view: Submodel.View<Model, Message, ModalViewInputs>
	readonly subscriptions?: Subscription.Subscriptions<ModalSubscriptionInput<Model>, Message, HazelRpc>
}

export interface ModalSlotBase {
	readonly _tag: string
}
export interface ModalMessageBase {
	readonly _tag: string
}
export interface ModalHost {
	readonly modal: ModalSlotBase | null
	readonly shared: Shared
}

export interface ModalStep<Slot, Wrapped> {
	readonly slot: Slot
	readonly commands: ReadonlyArray<Command.Command<Wrapped, never, HazelRpc>>
	readonly outMessage: Option.Option<ModalOutMessage>
}

/** Request `{ _tag: id, ...fields }` (from `requests.ts`), slot `{ _tag: id, model }`, Messages `{ _tag: id, message }`. */
/** The request schema comes from `requests.ts`, so out-messages stay free of modal views. */
export const defineModal = <
	const Id extends string,
	RequestSchema extends Schema.Top & { readonly Type: { readonly _tag: Id } },
	ModelSchema extends Schema.Top,
	MessageSchema extends Schema.Top,
>(
	id: Id,
	schemas: { readonly request: RequestSchema; readonly Model: ModelSchema; readonly Message: MessageSchema },
	spec: ModalSpec<RequestSchema["Type"], ModelSchema["Type"], MessageSchema["Type"]>,
) => {
	type Model = ModelSchema["Type"]
	type Message = MessageSchema["Type"]
	const Request = schemas.request
	const Slot = Schema.TaggedStruct(id, { model: schemas.Model })
	const Wrapped = Schema.TaggedStruct(id, { message: schemas.Message })
	type RequestType = typeof Request.Type
	type SlotType = { readonly _tag: Id; readonly model: Model }
	type WrappedType = { readonly _tag: Id; readonly message: Message }

	// The tags are unique across the registry, so a matching tag is this modal's value.
	const isOwnRequest = Schema.is(Request)
	const isOwnSlot = (slot: ModalSlotBase): slot is SlotType => slot._tag === id
	const isOwnMessage = (message: ModalMessageBase): message is WrappedType => message._tag === id
	const wrap = (message: Message): WrappedType => ({ _tag: id, message })
	const step = (result: ModalReturn<Model, Message>): ModalStep<SlotType, WrappedType> => ({
		slot: { _tag: id, model: result.model },
		commands: Command.mapMessages(result.commands, wrap),
		outMessage: Option.fromNullishOr(result.outMessage),
	})

	const lifted = Subscription.lift(spec.subscriptions ?? {})<ModalHost, WrappedType>({
		read: (host) =>
			host.modal !== null && isOwnSlot(host.modal)
				? Option.some({ model: host.modal.model, shared: host.shared })
				: Option.none(),
		toParentMessage: wrap,
	})

	return {
		id,
		Request,
		Slot,
		Wrapped,
		init: (request: unknown, shared: Shared) =>
			isOwnRequest(request)
				? Option.some(step(spec.init(request, shared)))
				: Option.none<ModalStep<SlotType, WrappedType>>(),
		update: (slot: ModalSlotBase, message: ModalMessageBase, shared: Shared) =>
			isOwnSlot(slot) && isOwnMessage(message)
				? Option.some(step(spec.update(slot.model, message.message, shared)))
				: Option.none<ModalStep<SlotType, WrappedType>>(),
		hostView: Submodel.defineView<ModalSlotBase, WrappedType, ModalViewInputs>((slot, inputs, h) =>
			isOwnSlot(slot)
				? h.submodel({
						slotId: `modal:${id}`,
						model: slot.model,
						view: spec.view,
						viewInputs: inputs,
						toParentMessage: wrap,
					})
				: h.empty,
		),
		/** Keys are prefixed with the modal id: Subscription keys share one namespace. */
		subscriptions: Object.fromEntries(
			Object.entries(lifted).map(([key, entry]) => [`modal.${id}.${key}`, entry]),
		),
	}
}
