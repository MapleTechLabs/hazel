import { Array, Effect, type Equivalence, Schema, Stream } from "effect"
import { Command, Submodel, Subscription } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import type { Resources } from "../rpc"
import { AppRoute } from "../route"
import { appError, appLoader } from "../shell/layouts"
import type { PageHost, PageViewInputs } from "./contract"

/**
 * Lazy pages. An area is a group of pages built into its own chunk, which the app fetches when one
 * of the area's routes is first entered. Until the chunk arrives the page slot is a `PagePending`
 * (a loader; a failed fetch offers a reload, since a deploy removes the chunks of the build before
 * it). An area that is already loaded opens its page at once, like a page of the first chunk.
 */

// AREA

export const Message = defineMessageUnion({
	LoadedPages: {},
	FailedLoadPages: {},
	PressedReload: {},
	CompletedReload: {},
})
export type Message = typeof Message.Type

export const lazyArea = <Page extends { readonly id: string }>(
	id: string,
	ownsRoute: (route: AppRoute) => boolean,
	importPages: () => Promise<{ readonly pages: ReadonlyArray<Page> }>,
) => {
	let pages: ReadonlyArray<Page> | undefined
	let byId: ReadonlyMap<string, Page> = new Map()
	let loading: Promise<ReadonlyArray<Page>> | undefined
	const load = () =>
		(loading ??= importPages().then(
			(module) => {
				pages = module.pages
				byId = new Map(module.pages.map((page) => [page.id, page]))
				return module.pages
			},
			(error: unknown) => {
				loading = undefined
				throw error
			},
		))
	const LoadPages = Command.define("LoadPages", {
		args: { area: Schema.String },
		messages: [Message.LoadedPages, Message.FailedLoadPages],
		execute: () =>
			Effect.tryPromise(load).pipe(
				Effect.match({
					onSuccess: () => Message.LoadedPages(),
					onFailure: () => Message.FailedLoadPages(),
				}),
			),
	})
	return {
		id,
		ownsRoute,
		/** The area's pages, once its chunk has arrived. */
		pages: () => pages,
		pageById: (pageId: string) => byId.get(pageId),
		/** Fetches the chunk, once; after a failed fetch the next call tries again. */
		load,
		/** `load` as a Command. */
		Load: LoadPages({ area: id }),
	}
}

export type LazyArea<Page extends { readonly id: string }> = ReturnType<typeof lazyArea<Page>>

// PENDING SLOT

/** The page slot while an area's chunk is on its way: `key` is the area's id. */
export const Slot = Schema.TaggedStruct("PagePending", {
	key: Schema.String,
	instance: Schema.Int,
	/** The route to open once the chunk has arrived. */
	route: AppRoute,
	hasFailed: Schema.Boolean,
})
export type Slot = typeof Slot.Type

/** Like a page's own Messages: `key` names the instance, so a late answer for another one is dropped. */
export const Wrapped = Schema.TaggedStruct("PagePending", {
	message: Message,
	key: Schema.optional(Schema.String),
})
export type Wrapped = typeof Wrapped.Type

export const isSlot = (slot: { readonly _tag: string }): slot is Slot => slot._tag === "PagePending"
export const isWrapped = (message: { readonly _tag: string }): message is Wrapped =>
	message._tag === "PagePending"

const instanceKeyOf = (slot: Slot) => `${slot.key}#${slot.instance}`

const wrapFor =
	(slot: Slot) =>
	(message: Message): Wrapped => ({ _tag: "PagePending", key: instanceKeyOf(slot), message })

const ReloadForPages = Command.define("ReloadForPages", {
	messages: [Message.CompletedReload],
	execute: Effect.sync(() => window.location.reload()).pipe(Effect.as(Message.CompletedReload())),
})

export interface PendingStep {
	readonly slot: Slot
	readonly commands?: ReadonlyArray<Command.Command<Wrapped, never, Resources>>
}

/** The slot for `route` while `area` loads, and the Command that fetches it. */
export const enter = (
	area: Pick<LazyArea<never>, "id" | "Load">,
	route: AppRoute,
	instance: number,
): PendingStep => {
	const slot: Slot = { _tag: "PagePending", key: area.id, instance, route, hasFailed: false }
	return { slot, commands: Command.mapMessages([area.Load], wrapFor(slot)) }
}

/**
 * `open` builds the page the slot was waiting for (its area has loaded). A Message for another
 * instance (the user moved on while the chunk loaded) changes nothing.
 */
export const update = <Transition>(
	slot: Slot,
	wrapped: Wrapped,
	open: (slot: Slot) => Transition,
	stay: (step: PendingStep) => Transition,
): Transition =>
	wrapped.key !== undefined && wrapped.key !== instanceKeyOf(slot)
		? stay({ slot })
		: Message.match<Transition>(wrapped.message, {
				LoadedPages: () => open(slot),
				FailedLoadPages: () => stay({ slot: { ...slot, hasFailed: true } }),
				PressedReload: () =>
					stay({ slot, commands: Command.mapMessages([ReloadForPages()], wrapFor(slot)) }),
				CompletedReload: () => stay({ slot }),
			})

/** The loader waits a moment before it shows: a chunk from the cache arrives sooner than that. */
export const view = Submodel.defineView<Slot, Wrapped, PageViewInputs>((slot, _inputs, h) =>
	slot.hasFailed
		? appError(h, {
				title: "This page did not load",
				description: "Hazel may have been updated since you opened it. Reload to continue.",
				onRetry: wrapFor(slot)(Message.PressedReload()),
			})
		: h.div([h.Class("fade-in fill-mode-backwards animate-in delay-300 duration-200")], [appLoader(h)]),
)

// SUBSCRIPTIONS

type Entry<PageMessage> = Subscription.Subscriptions<PageHost, PageMessage, Resources>[string]

/**
 * How many Subscriptions one lazy page may declare. The app's Subscriptions are fixed when it
 * starts, before a lazy page's own exist, so this many pool entries each run one Subscription of
 * the lazy page on screen. `registry.test.ts` checks every lazy page against it.
 */
export const SUBSCRIPTION_POOL_SIZE = 24

/** A lazy page's Subscription in a pool entry, with the dependencies it derived from the host. */
interface Active<PageMessage> {
	readonly entry: Entry<PageMessage>
	readonly dependencies: unknown
}

/**
 * Pool entry `index` runs Subscription `index` of the page `entriesOf` reads from the host, exactly
 * as the runtime would run it: restarted when its own dependencies change (or another page takes the
 * entry), kept while they are equivalent.
 */
export const pooledSubscriptions = <PageMessage>(
	entriesOf: (host: PageHost) => ReadonlyArray<Entry<PageMessage>>,
) => {
	// The pool brings its own equivalence, so this schema only names the field.
	const ActiveSchema = Schema.declare(
		(value): value is Active<PageMessage> | null => typeof value === "object",
	)
	const equivalences = new WeakMap<Entry<PageMessage>, Equivalence.Equivalence<unknown>>()
	const equivalenceOf = (entry: Entry<PageMessage>): Equivalence.Equivalence<unknown> => {
		const cached = equivalences.get(entry)
		if (cached !== undefined) return cached
		const equivalence: Equivalence.Equivalence<unknown> =
			entry.keepAliveEquivalence ?? Schema.toEquivalence(entry.dependenciesSchema)
		equivalences.set(entry, equivalence)
		return equivalence
	}
	const isSame = (left: Active<PageMessage> | null, right: Active<PageMessage> | null): boolean =>
		left === null || right === null
			? left === right
			: left.entry === right.entry && equivalenceOf(left.entry)(left.dependencies, right.dependencies)

	return Subscription.make<PageHost, PageMessage, Resources>()((define) =>
		Object.fromEntries(
			Array.makeBy(SUBSCRIPTION_POOL_SIZE, (index) => [
				`lazy.${index}`,
				define(
					{ active: ActiveSchema },
					{
						modelToDependencies: (host) => {
							const entry = entriesOf(host)[index]
							return {
								active:
									entry === undefined
										? null
										: { entry, dependencies: entry.modelToDependencies(host) },
							}
						},
						keepAliveEquivalence: (left, right) => isSame(left.active, right.active),
						dependenciesToStream: ({ active }, read) => {
							if (active === null) return Stream.empty
							const { entry } = active
							if (entry.keepAliveEquivalence === undefined)
								return entry.dependenciesToStream(active.dependencies)
							// Until the runtime restarts the entry for another page, its own latest.
							return entry.dependenciesToStream(active.dependencies, () => {
								const latest = read().active
								return latest !== null && latest.entry === entry
									? latest.dependencies
									: active.dependencies
							})
						},
					},
				),
			]),
		),
	)
}
