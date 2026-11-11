import { Toast as UiToast } from "@foldkit/ui"
import { Array, Match, Option, Schema } from "effect"
import type { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { ToastAction } from "../overlay/toasts"

/**
 * The `@foldkit/ui` Toast bound to the app's payload. The kit owns each entry's lifecycle: the
 * enter and exit Animation, the auto-dismiss timer (paused while hovered), swipe to dismiss and the
 * `status`/`alert` role. The payload is what the view draws. `toast-view.ts` renders it.
 */

// MODEL

export const Kind = Schema.Literals(["success", "info", "warning", "error", "loading"])
export type Kind = typeof Kind.Type

/** A button that reports `key` to the root and dismisses the toast (sonner's `action`). */
export const Action = Schema.Struct({ label: Schema.String, key: ToastAction })
export type Action = typeof Action.Type

export const Payload = Schema.Struct({
	kind: Kind,
	title: Schema.String,
	maybeDescription: Schema.Option(Schema.String),
	maybeAction: Schema.Option(Action),
	/** A later toast with the same key replaces this one in place (sonner's `id`). */
	maybeKey: Schema.Option(Schema.String),
})
export type Payload = typeof Payload.Type

export const Toast = UiToast.make(Payload)
export type Entry = typeof Toast.Entry.Type
export type Model = typeof Toast.Model.Type
export type Message = typeof Toast.Message.Type
export const Message = Toast.Message

export const init = (): Model => Toast.init({ id: "toaster", swipeToDismiss: {} })

/** The kit's variant drives the ARIA role; a loading toast is a `status`, like info. */
export const variantOf = (kind: Kind): UiToast.Variant =>
	Match.value(kind).pipe(
		Match.withReturnType<UiToast.Variant>(),
		Match.when("success", () => "Success"),
		Match.when("info", () => "Info"),
		Match.when("loading", () => "Info"),
		Match.when("warning", () => "Warning"),
		Match.when("error", () => "Error"),
		Match.exhaustive,
	)

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

const isLeaving = (entry: Entry): boolean =>
	entry.animation.transitionState === "LeaveStart" || entry.animation.transitionState === "LeaveAnimating"

const liveEntryWithKey = (model: Model, maybeKey: Option.Option<string>): Option.Option<Entry> =>
	Option.flatMap(maybeKey, (key) =>
		Array.findFirst(
			model.entries,
			(entry) => !isLeaving(entry) && Option.contains(entry.payload.maybeKey, key),
		),
	)

/** Swaps an entry's content and restarts its timer; the version bump makes any running timer stale. */
const replace = (model: Model, entry: Entry, payload: Payload, isSticky: boolean): UpdateReturn => {
	const next = modifyFields(entry, {
		variant: () => variantOf(payload.kind),
		payload: () => payload,
		maybeDuration: () => (isSticky ? Option.none() : Option.some(model.defaultDuration)),
		pendingDismissVersion: (version) => version + 1,
	})
	const isTimerPaused = next.isHovered || UiToast.SwipeState.guards.Dragging(next.swipeState)
	return {
		model: modifyFields(model, {
			entries: Array.map((current) => (current.id === entry.id ? next : current)),
		}),
		commands: isTimerPaused
			? []
			: Array.map(Array.fromOption(next.maybeDuration), (duration) =>
					UiToast.WaitBeforeDismissal({
						entryId: next.id,
						version: next.pendingDismissVersion,
						duration,
					}),
				),
	}
}

/**
 * Shows a toast, or replaces the live toast with the same `maybeKey` in place (loading, then
 * success). A sticky toast stays until it is dismissed; loading toasts are always sticky.
 */
export const show = (model: Model, payload: Payload, isSticky: boolean): UpdateReturn => {
	const sticky = isSticky || payload.kind === "loading"
	return Option.match(liveEntryWithKey(model, payload.maybeKey), {
		onSome: (entry) => replace(model, entry, payload, sticky),
		onNone: () => {
			const shown = Toast.show(model, { payload, variant: variantOf(payload.kind), sticky })
			return { model: shown.model, commands: shown.commands ?? [] }
		},
	})
}

export const { update, dismiss, subscriptions } = Toast
