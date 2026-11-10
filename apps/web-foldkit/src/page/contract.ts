import type { RpcActionName } from "@hazel/domain/scopes"
import { canPerform, RPC_SCOPE_MAP } from "@hazel/domain/scopes"
import { Array, Option, Schema, Stream } from "effect"
import { Command, Submodel, Subscription, type Update } from "foldkit"
import type { Resources } from "../rpc"
import type { AppRoute, RouteOf, RouteTag } from "../route"
import type { Auth, CurrentUser, Member, Organization } from "../session"
import type { SoundSettings } from "../notification-sound"
import type { ThemeState } from "../theme"
import type * as Updates from "../platform/updates"
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
	/** The stored mode and customization, and the resolved light/dark theme (`resolvedThemeAtom`). */
	readonly theme: ThemeState
	/** `notificationSoundSettingsAtom`: what the sound sink and "Test sound" use. */
	readonly soundSettings: SoundSettings
	/** The desktop app's update check and install (always `Idle` on the web). */
	readonly desktopUpdate: Updates.Model
	/** A root modal or the command palette is open (it holds the keyboard; the composer's global typing waits). */
	readonly isOverlayOpen: boolean
}

/** `usePermission().can(action)` */
export const can = (shared: Shared, action: RpcActionName): boolean =>
	shared.member !== null && canPerform(RPC_SCOPE_MAP, shared.member.role, action)

/** `useAuth().isLoading`: the session check is pending, or signed in while `user.me` is pending. */
export const isSessionLoading = (shared: Shared): boolean =>
	shared.auth === "Loading" || (shared.auth === "SignedIn" && shared.currentUser === null)

export interface PageViewInputs {
	readonly shared: Shared
}

/** What a page's Subscriptions see: its own Model plus the shared state. */
export interface PageSubscriptionInput<Model> {
	readonly model: Model
	readonly shared: Shared
}

export type PageReturn<Model, Message> = Update.ReturnWithOutMessage<
	Model,
	Message,
	PageOutMessage,
	Resources
>

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

type PageEntry<Message> = Subscription.Subscriptions<PageHost, Message, Resources>[string]

/**
 * Binds a lifted entry to the page instance (its key), like React's unmount: a new instance builds a
 * fresh Model, so every Stream restarts and sends its rows again, even one whose own dependencies
 * did not change (a `{}` entry would otherwise keep running and never refill the new Model). Its
 * Messages carry the key: a row the previous instance's Stream sent late never reaches the new one.
 */
export const perInstance = <Message extends { readonly key?: string | undefined }>(
	entry: PageEntry<Message>,
	keyOf: (host: PageHost) => string | null,
): PageEntry<Message> => {
	const stamped = <E, R>(pageKey: string | null, stream: Stream.Stream<Message, E, R>) =>
		pageKey === null ? stream : Stream.map(stream, (message): Message => ({ ...message, key: pageKey }))
	const fields = { pageKey: Schema.NullOr(Schema.String), dependencies: entry.dependenciesSchema }
	const modelToDependencies = (host: PageHost) => ({
		pageKey: keyOf(host),
		dependencies: entry.modelToDependencies(host),
	})
	const keepAlive = entry.keepAliveEquivalence
	return Subscription.make<PageHost, Message, Resources>()((define) => ({
		bound:
			keepAlive === undefined
				? define(fields, {
						modelToDependencies,
						dependenciesToStream: (gated) =>
							stamped(gated.pageKey, entry.dependenciesToStream(gated.dependencies)),
					})
				: define(fields, {
						modelToDependencies,
						keepAliveEquivalence: (left, right) =>
							left.pageKey === right.pageKey &&
							keepAlive(left.dependencies, right.dependencies),
						dependenciesToStream: (gated, read) =>
							stamped(
								gated.pageKey,
								entry.dependenciesToStream(gated.dependencies, () => read().dependencies),
							),
					}),
	})).bound
}

/**
 * The page lives in the root Model as `{ _tag: id, key, instance, model }`; its Messages as
 * `{ _tag: id, message }`, plus the instance's key (`key#instance`) on a Command's answer and a
 * Subscription's Message: one for an instance that is gone (another org, account or provider, or the
 * same one left and come back to) is dropped, so pages need no per-answer org check.
 */
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
	const Slot = Schema.TaggedStruct(id, { key: Schema.String, instance: Schema.Int, model: schemas.Model })
	const Wrapped = Schema.TaggedStruct(id, { message: schemas.Message, key: Schema.optional(Schema.String) })
	type SlotType = {
		readonly _tag: Id
		readonly key: string
		readonly instance: number
		readonly model: Model
	}
	type WrappedType = { readonly _tag: Id; readonly message: Message; readonly key?: string }

	// The tags are unique across the registry, so a matching tag is this page's slot or Message.
	const isOwnSlot = (slot: PageSlotBase): slot is SlotType => slot._tag === id
	const isOwnMessage = (message: PageMessageBase): message is WrappedType => message._tag === id
	const instanceKeyOf = (slot: Pick<SlotType, "key" | "instance">) => `${slot.key}#${slot.instance}`
	const isForInstance = (slot: SlotType, message: WrappedType) =>
		message.key === undefined || message.key === instanceKeyOf(slot)
	const ownsRoute = (route: AppRoute): route is RouteOf<Tags> =>
		Array.some(spec.routes, (tag) => tag === route._tag)
	const wrap = (message: Message): WrappedType => ({ _tag: id, message })
	const keyOf = (route: RouteOf<Tags>) => (spec.key ? spec.key(route) : JSON.stringify(route))

	const step = (
		slot: Pick<SlotType, "key" | "instance">,
		result: PageReturn<Model, Message>,
	): PageStep<SlotType, WrappedType> => ({
		slot: { _tag: id, key: slot.key, instance: slot.instance, model: result.model },
		commands: Command.mapMessages(result.commands, (message): WrappedType => ({
			_tag: id,
			key: instanceKeyOf(slot),
			message,
		})),
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
		/** `instance` numbers it (the root counts them): leaving a key and coming back is another one. */
		init: (
			route: AppRoute,
			shared: Shared,
			instance: number,
		): Option.Option<PageStep<SlotType, WrappedType>> =>
			ownsRoute(route)
				? Option.some(step({ key: keyOf(route), instance }, spec.init(route, shared)))
				: Option.none(),
		update: (slot: PageSlotBase, message: PageMessageBase, shared: Shared) =>
			isOwnSlot(slot) && isOwnMessage(message) && isForInstance(slot, message)
				? Option.some(step(slot, spec.update(slot.model, message.message, shared)))
				: Option.none<PageStep<SlotType, WrappedType>>(),
		routeChanged: (slot: PageSlotBase, route: AppRoute, shared: Shared) =>
			isOwnSlot(slot) && ownsRoute(route) && spec.routeChanged
				? Option.some(step(slot, spec.routeChanged(slot.model, route, shared)))
				: Option.none<PageStep<SlotType, WrappedType>>(),
		sharedChanged: (slot: PageSlotBase, shared: Shared) =>
			isOwnSlot(slot) && spec.sharedChanged
				? Option.some(step(slot, spec.sharedChanged(slot.model, shared)))
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
			Object.entries(lifted).map(([key, entry]) => [
				`${id}.${key}`,
				perInstance(entry, (host) =>
					host.page !== null && isOwnSlot(host.page) ? instanceKeyOf(host.page) : null,
				),
			]),
		),
	}
}
