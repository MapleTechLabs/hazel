import { Array, Duration, Effect, Option, Queue, Schema, Stream } from "effect"
import { Command, Mount, Subscription, type Update } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { sonnerCss } from "~/components/ui/sonner.styles"

/**
 * Port of `components/ui/toast.tsx` (sonner's Toaster with rich colors): the queue, stacking,
 * expand on hover, timers and dismissal. The view, in `toast-view.ts`, renders sonner's DOM.
 * Not ported: swipe to dismiss and focus restoration when focus leaves the toaster.
 */

// sonner injects its stylesheet into <head> when its module loads; so does this port.
const sonnerStyle = document.createElement("style")
sonnerStyle.type = "text/css"
sonnerStyle.appendChild(document.createTextNode(sonnerCss))
document.head.appendChild(sonnerStyle)

// MODEL

export const Kind = Schema.Literals(["success", "info", "warning", "error", "loading"])
export type Kind = typeof Kind.Type

export const Item = Schema.Struct({
	id: Schema.Number,
	/** `null` for a plain `toast()`, which renders no `data-type`. */
	kind: Schema.NullOr(Kind),
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	actionLabel: Schema.NullOr(Schema.String),
	isPromise: Schema.Boolean,
	/** Milliseconds, `null` for an infinite duration. */
	duration: Schema.NullOr(Schema.Number),
	remainingMs: Schema.Number,
	isMounted: Schema.Boolean,
	isRemoved: Schema.Boolean,
	initialHeight: Schema.Number,
	offsetBeforeRemove: Schema.Number,
	/** Bumped on every timer start or pause, so a stale lifetime never dismisses. */
	timerVersion: Schema.Number,
	timerStartedAt: Schema.NullOr(Schema.Number),
})
export type Item = typeof Item.Type

const Height = Schema.Struct({ toastId: Schema.Number, height: Schema.Number })

export const Model = Schema.Struct({
	/** Newest first: index 0 is the front toast. */
	toasts: Schema.Array(Item),
	/** Measured heights, newest measurement first (sonner's `heights`). */
	heights: Schema.Array(Height),
	isExpanded: Schema.Boolean,
	isInteracting: Schema.Boolean,
	isDocumentHidden: Schema.Boolean,
	nextId: Schema.Number,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	toasts: [],
	heights: [],
	isExpanded: false,
	isInteracting: false,
	isDocumentHidden: false,
	nextId: 1,
})

/** sonner's defaults. */
export const VISIBLE_TOASTS = 3
export const GAP = 14
const LIFETIME_MS = 4000
const TIME_BEFORE_UNMOUNT = Duration.millis(200)

// MESSAGE

export const Message = defineMessageUnion({
	MeasuredToast: { id: Schema.Number, height: Schema.Number },
	HoveredToaster: {},
	LeftToaster: {},
	PressedToaster: {},
	ReleasedToaster: {},
	ClickedAction: { id: Schema.Number },
	PressedHotkey: {},
	PressedEscape: {},
	ChangedVisibility: { isHidden: Schema.Boolean },
	StartedTimer: { id: Schema.Number, version: Schema.Number, at: Schema.Number },
	PausedTimers: { at: Schema.Number },
	CompletedWaitForLifetime: { id: Schema.Number, version: Schema.Number },
	CompletedWaitForRemoval: { id: Schema.Number },
	CompletedFocusToaster: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
	ClickedAction: { id: Schema.Number },
})
export type OutMessage = typeof OutMessage.Type

// COMMAND

const StartTimer = Command.define("StartToastTimer", {
	args: { id: Schema.Number, version: Schema.Number },
	messages: [Message.StartedTimer],
	execute: ({ id, version }) => Effect.sync(() => Message.StartedTimer({ id, version, at: Date.now() })),
})

const PauseTimers = Command.define("PauseToastTimers", {
	messages: [Message.PausedTimers],
	execute: Effect.sync(() => Message.PausedTimers({ at: Date.now() })),
})

const WaitForLifetime = Command.define("WaitForToastLifetime", {
	args: { id: Schema.Number, version: Schema.Number, ms: Schema.Number },
	messages: [Message.CompletedWaitForLifetime],
	execute: ({ id, version, ms }) =>
		Effect.sleep(Duration.millis(ms)).pipe(Effect.as(Message.CompletedWaitForLifetime({ id, version }))),
})

const WaitForRemoval = Command.define("WaitForToastRemoval", {
	args: { id: Schema.Number },
	messages: [Message.CompletedWaitForRemoval],
	execute: ({ id }) =>
		Effect.sleep(TIME_BEFORE_UNMOUNT).pipe(Effect.as(Message.CompletedWaitForRemoval({ id }))),
})

const FocusToaster = Command.define("FocusToaster", {
	messages: [Message.CompletedFocusToaster],
	execute: Dom.focus("[data-sonner-toaster]").pipe(
		Effect.ignore,
		Effect.as(Message.CompletedFocusToaster()),
	),
})

// MOUNT

/** sonner measures a toast at mount and whenever its content changes, with `height: auto`. */
const naturalHeight = (element: HTMLElement) => {
	const original = element.style.height
	element.style.height = "auto"
	const height = element.getBoundingClientRect().height
	element.style.height = original
	return height
}

export const MeasureToast = Mount.defineStream("MeasureToast", {
	args: { id: Schema.Number },
	messages: [Message.MeasuredToast],
	execute: ({ element, id }) =>
		Stream.callback<typeof Message.MeasuredToast.Type>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					if (!(element instanceof HTMLElement)) return () => undefined
					const emit = () =>
						Queue.offerUnsafe(
							queue,
							Message.MeasuredToast({ id, height: naturalHeight(element) }),
						)
					const observer = new MutationObserver(emit)
					observer.observe(element, { childList: true, characterData: true, subtree: true })
					emit()
					return () => observer.disconnect()
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

// LAYOUT

/** sonner's per-toast offset in the expanded stack (`heightIndex * gap + toastsHeightBefore`). */
export const offsetOf = (model: Model, item: Item): number => {
	if (item.isRemoved) return item.offsetBeforeRemove
	const heightIndex = model.heights.findIndex((height) => height.toastId === item.id)
	const before = model.heights.reduce(
		(sum, height, index) => (index >= heightIndex ? sum : sum + height.height),
		0,
	)
	return heightIndex * GAP + before
}

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

const isPaused = (model: Model) => model.isExpanded || model.isInteracting || model.isDocumentHidden

const hasTimer = (item: Item) => !item.isRemoved && item.duration !== null && item.kind !== "loading"

const mapItem = (model: Model, id: number, f: (item: Item) => Item): Model =>
	modifyFields(model, { toasts: Array.map((item) => (item.id === id ? f(item) : item)) })

/** Restarts one toast's timer (sonner's effect re-runs when the toast changes). */
const restartTimer = (model: Model, id: number): UpdateReturn => {
	const item = Array.findFirst(model.toasts, (candidate) => candidate.id === id)
	if (Option.isNone(item) || !hasTimer(item.value) || isPaused(model)) return { model }
	const version = item.value.timerVersion + 1
	return {
		model: mapItem(model, id, (current) => ({ ...current, timerVersion: version, timerStartedAt: null })),
		commands: [StartTimer({ id, version })],
	}
}

/** Pauses or resumes every timer when hover, press or visibility flips the paused state. */
const syncPause = (before: Model, after: UpdateReturn): UpdateReturn => {
	const model = after.model
	const commands = after.commands ?? []
	if (isPaused(before) === isPaused(model)) return after
	if (isPaused(model))
		return {
			model: modifyFields(model, {
				toasts: Array.map((item) => ({ ...item, timerVersion: item.timerVersion + 1 })),
			}),
			commands: [...commands, PauseTimers()],
		}
	return model.toasts.reduce<UpdateReturn>(
		(result, item) => {
			const next = restartTimer(result.model, item.id)
			return { model: next.model, commands: [...(result.commands ?? []), ...(next.commands ?? [])] }
		},
		{ model, commands },
	)
}

/** sonner collapses the stack whenever one toast or none is left. */
const collapseWhenAlone = (model: Model): Model =>
	model.toasts.length <= 1 ? modifyFields(model, { isExpanded: () => false }) : model

const deleteToast = (model: Model, id: number): UpdateReturn => {
	const item = Array.findFirst(model.toasts, (candidate) => candidate.id === id)
	if (Option.isNone(item) || item.value.isRemoved) return { model }
	const offset = offsetOf(model, item.value)
	return {
		model: modifyFields(
			mapItem(model, id, (current) => ({ ...current, isRemoved: true, offsetBeforeRemove: offset })),
			{
				heights: Array.filter((height) => height.toastId !== id),
			},
		),
		commands: [WaitForRemoval({ id })],
	}
}

export const update = (
	model: Model,
	message: Message,
): Update.ReturnWithOutMessage<Model, Message, OutMessage> =>
	Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage>>(message, {
		MeasuredToast: ({ id, height }) => {
			const isKnown = model.heights.some((entry) => entry.toastId === id)
			const heights = isKnown
				? Array.map(model.heights, (entry) => (entry.toastId === id ? { ...entry, height } : entry))
				: [{ toastId: id, height }, ...model.heights]
			const item = Array.findFirst(model.toasts, (candidate) => candidate.id === id)
			if (Option.isNone(item) || item.value.isRemoved) return { model }
			return {
				model: modifyFields(
					mapItem(model, id, (current) => ({ ...current, isMounted: true, initialHeight: height })),
					{ heights: () => heights },
				),
			}
		},
		HoveredToaster: () => syncPause(model, { model: modifyFields(model, { isExpanded: () => true }) }),
		LeftToaster: () =>
			model.isInteracting
				? { model }
				: syncPause(model, { model: modifyFields(model, { isExpanded: () => false }) }),
		PressedToaster: () => syncPause(model, { model: modifyFields(model, { isInteracting: () => true }) }),
		ReleasedToaster: () =>
			syncPause(model, { model: modifyFields(model, { isInteracting: () => false }) }),
		ClickedAction: ({ id }) => ({
			...deleteToast(model, id),
			outMessage: OutMessage.ClickedAction({ id }),
		}),
		PressedHotkey: () => {
			const next = syncPause(model, { model: modifyFields(model, { isExpanded: () => true }) })
			return { model: next.model, commands: [...(next.commands ?? []), FocusToaster()] }
		},
		PressedEscape: () => syncPause(model, { model: modifyFields(model, { isExpanded: () => false }) }),
		ChangedVisibility: ({ isHidden }) =>
			syncPause(model, { model: modifyFields(model, { isDocumentHidden: () => isHidden }) }),
		StartedTimer: ({ id, version, at }) => {
			const item = Array.findFirst(model.toasts, (candidate) => candidate.id === id)
			if (Option.isNone(item) || item.value.timerVersion !== version) return { model }
			return {
				model: mapItem(model, id, (current) => ({ ...current, timerStartedAt: at })),
				commands: [WaitForLifetime({ id, version, ms: item.value.remainingMs })],
			}
		},
		PausedTimers: ({ at }) => ({
			model: modifyFields(model, {
				toasts: Array.map((item) =>
					item.timerStartedAt === null
						? item
						: {
								...item,
								remainingMs: item.remainingMs - (at - item.timerStartedAt),
								timerStartedAt: null,
							},
				),
			}),
		}),
		CompletedWaitForLifetime: ({ id, version }) => {
			const item = Array.findFirst(model.toasts, (candidate) => candidate.id === id)
			return Option.isSome(item) && item.value.timerVersion === version
				? deleteToast(model, id)
				: { model }
		},
		CompletedWaitForRemoval: ({ id }) =>
			syncPause(model, {
				model: collapseWhenAlone(
					modifyFields(model, { toasts: Array.filter((item) => item.id !== id) }),
				),
			}),
		CompletedFocusToaster: () => ({ model }),
	})

// API

export interface ShowOptions {
	/** Updates the toast with this id instead of adding one (sonner's `id` option). */
	readonly id?: number
	readonly kind?: Kind | null
	readonly title: string
	readonly description?: string
	readonly actionLabel?: string
	/** A `toast.promise` toast keeps `data-promise` after it resolves. */
	readonly isPromise?: boolean
	/** Milliseconds; `Infinity` keeps the toast until it is dismissed. */
	readonly duration?: number
}

const durationOf = (duration: number | undefined) =>
	duration === Number.POSITIVE_INFINITY ? null : (duration ?? LIFETIME_MS)

/** sonner's `toast()`/`toast.success()`/...: adds a toast, or updates the one with `options.id`. */
export const show = (model: Model, options: ShowOptions): UpdateReturn & { readonly id: number } => {
	const id = options.id ?? model.nextId
	const existing = Array.findFirst(model.toasts, (item) => item.id === id)
	if (Option.isSome(existing)) {
		const duration =
			options.duration === undefined ? existing.value.duration : durationOf(options.duration)
		const updated = mapItem(model, id, (item) => ({
			...item,
			kind: options.kind === undefined ? item.kind : options.kind,
			title: options.title,
			description: options.description ?? item.description,
			actionLabel: options.actionLabel ?? item.actionLabel,
			isPromise: item.isPromise || (options.isPromise ?? false),
			duration,
			remainingMs: duration === item.duration ? item.remainingMs : (duration ?? 0),
		}))
		return { ...restartTimer(updated, id), id }
	}
	const duration = durationOf(options.duration)
	const item: Item = {
		id,
		kind: options.kind ?? null,
		title: options.title,
		description: options.description ?? null,
		actionLabel: options.actionLabel ?? null,
		isPromise: options.isPromise ?? false,
		duration,
		remainingMs: duration ?? 0,
		isMounted: false,
		isRemoved: false,
		initialHeight: 0,
		offsetBeforeRemove: 0,
		timerVersion: 0,
		timerStartedAt: null,
	}
	const added = collapseWhenAlone(
		modifyFields(model, {
			toasts: (toasts) => [item, ...toasts],
			nextId: (nextId) => Math.max(nextId, id + 1),
		}),
	)
	return { ...syncPause(model, restartTimer(added, id)), id }
}

/**
 * A serializable toast request, for Messages and OutMessages (a page's `RequestedToast`).
 * `durationMs` omitted means sonner's 4s default; `null` keeps the toast until dismissed.
 */
export const Request = Schema.Struct({
	kind: Schema.NullOr(Kind),
	title: Schema.String,
	description: Schema.optionalKey(Schema.String),
	actionLabel: Schema.optionalKey(Schema.String),
	durationMs: Schema.optionalKey(Schema.NullOr(Schema.Number)),
})
export type Request = typeof Request.Type

/** `show` for a Request: what a root `toasts` slot calls when a page asks for a toast. */
export const showRequest = (model: Model, request: Request): UpdateReturn & { readonly id: number } =>
	show(model, {
		kind: request.kind,
		title: request.title,
		...(request.description === undefined ? {} : { description: request.description }),
		...(request.actionLabel === undefined ? {} : { actionLabel: request.actionLabel }),
		...(request.durationMs === undefined
			? {}
			: { duration: request.durationMs ?? Number.POSITIVE_INFINITY }),
	})

/** sonner's `toast.dismiss(id)`. */
export const dismiss = (model: Model, id: number): UpdateReturn => deleteToast(model, id)

// SUBSCRIPTION

const isInsideToaster = () => document.activeElement?.closest("[data-sonner-toaster]") != null

export const subscriptions = Subscription.make<Model, Message>()(() => ({
	keys: Subscription.persistent(
		Subscription.fromEventFilterMap({
			target: document,
			type: "keydown",
			filterMapEvent: (event) =>
				event.altKey && event.code === "KeyT"
					? Option.some(Message.PressedHotkey())
					: event.code === "Escape" && isInsideToaster()
						? Option.some(Message.PressedEscape())
						: Option.none(),
		}),
	),
	visibility: Subscription.persistent(
		Subscription.fromEvent({
			target: document,
			type: "visibilitychange",
			mapEvent: () => Message.ChangedVisibility({ isHidden: document.hidden }),
		}),
	),
}))
