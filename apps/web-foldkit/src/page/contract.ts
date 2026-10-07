import type { RpcActionName } from "@hazel/domain/scopes"
import { canPerform, RPC_SCOPE_MAP } from "@hazel/domain/scopes"
import { Array, Option, Schema } from "effect"
import { Command, Submodel, Subscription, type Update } from "foldkit"
import type { Resources } from "../rpc"
import type { AppRoute, RouteOf, RouteTag } from "../route"
import type { Auth, CurrentUser, Member, Organization } from "../session"
import type { PageOutMessage } from "./out-message"

/** The page contract: every routed page is a Submodel registered once in `registry.ts`. See README.md. */

// SHARED STATE

/** Root-owned state every page may read. Never copy it into a page Model; read it here. */
export interface Shared {
	readonly auth: Auth
	readonly orgSlug: string | null
	readonly currentUser: CurrentUser | null
	readonly organization: Organization | null
	readonly member: Member | null
	/** Wall clock for presence, ticking every 30 s (legacy `presenceNowSignal`). */
	readonly nowMs: number
	/** `useSidebar().isMobile`: the `(max-width: 767px)` viewport. */
	readonly isMobile: boolean
}

/** `usePermission().can(action)` */
export const can = (shared: Shared, action: RpcActionName): boolean =>
	shared.member !== null && canPerform(RPC_SCOPE_MAP, shared.member.role, action)

export interface PageViewInputs {
	readonly shared: Shared
}

/** What a page's Subscriptions see: its own Model plus the shared state. */
export interface PageSubscriptionInput<Model> {
	readonly model: Model
	readonly shared: Shared
}

export type PageReturn<Model, Message> = Update.ReturnWithOutMessage<Model, Message, PageOutMessage, Resources>

// SPEC (what a page module provides)

export interface PageSpec<Tags extends RouteTag, Model, Message> {
	/** The routes this page renders. One page may serve several (a layout with tabs). */
	readonly routes: ReadonlyArray<Tags>
	/** The page instance survives route changes while this stays equal (default: the whole route). */
	readonly key?: (route: RouteOf<Tags>) => string
	readonly init: (route: RouteOf<Tags>, shared: Shared) => PageReturn<Model, Message>
	readonly update: (model: Model, message: Message, shared: Shared) => PageReturn<Model, Message>
	readonly view: Submodel.View<Model, Message, PageViewInputs>
	readonly subscriptions?: Subscription.Subscriptions<PageSubscriptionInput<Model>, Message, Resources>
	/** Same instance, new route (search params, or a tab inside the page). */
	readonly routeChanged?: (model: Model, route: RouteOf<Tags>, shared: Shared) => PageReturn<Model, Message>
	/** The signed-in user, organization or membership changed. */
	readonly sharedChanged?: (model: Model, shared: Shared) => PageReturn<Model, Message>
}

// ERASED PAGE (what the registry and root consume)

export interface PageSlotBase {
	readonly _tag: string
	readonly key: string
}
export interface PageMessageBase {
	readonly _tag: string
}
/** The root as page Subscriptions see it. */
export interface PageHost {
	readonly page: PageSlotBase | null
	readonly shared: Shared
}

export interface PageStep<Slot, Wrapped> {
	readonly slot: Slot
	readonly commands: ReadonlyArray<Command.Command<Wrapped, never, Resources>>
	readonly outMessage: Option.Option<PageOutMessage>
}

/** The page lives in the root Model as `{ _tag: id, key, model }`; its Messages as `{ _tag: id, message }`. */
export const definePage = <
	const Id extends string,
	Tags extends RouteTag,
	ModelSchema extends Schema.Top,
	MessageSchema extends Schema.Top,
>(
	id: Id,
	schemas: { readonly Model: ModelSchema; readonly Message: MessageSchema },
	spec: PageSpec<Tags, ModelSchema["Type"], MessageSchema["Type"]>,
) => {
	type Model = ModelSchema["Type"]
	type Message = MessageSchema["Type"]
	const Slot = Schema.TaggedStruct(id, { key: Schema.String, model: schemas.Model })
	const Wrapped = Schema.TaggedStruct(id, { message: schemas.Message })
	type SlotType = { readonly _tag: Id; readonly key: string; readonly model: Model }
	type WrappedType = { readonly _tag: Id; readonly message: Message }

	// The tags are unique across the registry, so a matching tag is this page's slot or Message.
	const isOwnSlot = (slot: PageSlotBase): slot is SlotType => slot._tag === id
	const isOwnMessage = (message: PageMessageBase): message is WrappedType => message._tag === id
	const ownsRoute = (route: AppRoute): route is RouteOf<Tags> =>
		Array.some(spec.routes, (tag) => tag === route._tag)
	const wrap = (message: Message): WrappedType => ({ _tag: id, message })
	const keyOf = (route: RouteOf<Tags>) => (spec.key ? spec.key(route) : JSON.stringify(route))

	const step = (key: string, result: PageReturn<Model, Message>): PageStep<SlotType, WrappedType> => ({
		slot: { _tag: id, key, model: result.model },
		commands: Command.mapMessages(result.commands, wrap),
		outMessage: Option.fromNullishOr(result.outMessage),
	})

	const lifted = Subscription.lift(spec.subscriptions ?? {})<PageHost, WrappedType>({
		read: (host) =>
			host.page !== null && isOwnSlot(host.page)
				? Option.some({ model: host.page.model, shared: host.shared })
				: Option.none(),
		toParentMessage: wrap,
	})

	return {
		id,
		Slot,
		Wrapped,
		ownsRoute,
		keyOf: (route: AppRoute): Option.Option<string> =>
			ownsRoute(route) ? Option.some(keyOf(route)) : Option.none(),
		init: (route: AppRoute, shared: Shared): Option.Option<PageStep<SlotType, WrappedType>> =>
			ownsRoute(route) ? Option.some(step(keyOf(route), spec.init(route, shared))) : Option.none(),
		update: (slot: PageSlotBase, message: PageMessageBase, shared: Shared) =>
			isOwnSlot(slot) && isOwnMessage(message)
				? Option.some(step(slot.key, spec.update(slot.model, message.message, shared)))
				: Option.none<PageStep<SlotType, WrappedType>>(),
		routeChanged: (slot: PageSlotBase, route: AppRoute, shared: Shared) =>
			isOwnSlot(slot) && ownsRoute(route) && spec.routeChanged
				? Option.some(step(slot.key, spec.routeChanged(slot.model, route, shared)))
				: Option.none<PageStep<SlotType, WrappedType>>(),
		sharedChanged: (slot: PageSlotBase, shared: Shared) =>
			isOwnSlot(slot) && spec.sharedChanged
				? Option.some(step(slot.key, spec.sharedChanged(slot.model, shared)))
				: Option.none<PageStep<SlotType, WrappedType>>(),
		/** The root embeds this; it renders the page's own view under its own boundary. */
		hostView: Submodel.defineView<PageSlotBase, WrappedType, PageViewInputs>((slot, inputs, h) =>
			isOwnSlot(slot)
				? h.submodel({
						slotId: id,
						model: slot.model,
						view: spec.view,
						viewInputs: { shared: inputs.shared },
						toParentMessage: wrap,
					})
				: h.empty,
		),
		/** Keys are prefixed with the page id: Subscription keys share one namespace. */
		subscriptions: Object.fromEntries(
			Object.entries(lifted).map(([key, entry]) => [`${id}.${key}`, entry]),
		),
	}
}
