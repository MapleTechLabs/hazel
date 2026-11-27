// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A destructive action behind a confirmation dialog (today's `web-foldkit/src/page/shared/confirm-action.ts`):
 * nothing asked, asking about a target, or running the action for it. The page keeps the state in its
 * Model; the dialog is open exactly while there is a target, and its buttons are the page's messages.
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"

/** The state's Schema for a target Schema. */
export const ConfirmState = <S extends Schema.Top>(target: S) =>
	Schema.Union([
		Schema.TaggedStruct("Closed", {}),
		Schema.TaggedStruct("Confirming", { target }),
		Schema.TaggedStruct("Running", { target }),
	])

export type ConfirmState<Target> =
	| { readonly _tag: "Closed" }
	| { readonly _tag: "Confirming"; readonly target: Target }
	| { readonly _tag: "Running"; readonly target: Target }

export const closed: ConfirmState<never> = { _tag: "Closed" }

/** The target asked about or acted on. */
export const targetOf = <Target>(state: ConfirmState<Target>): Target | undefined =>
	state._tag === "Closed" ? undefined : state.target

/** Opens the dialog for `target`; ignored while an action runs. */
export const ask = <Target>(state: ConfirmState<Target>, target: Target): ConfirmState<Target> =>
	state._tag === "Running" ? state : { _tag: "Confirming", target }

/** The user confirmed: `Running`, with the target to act on; undefined unless a confirmation is open. */
export const confirm = <Target>(
	state: ConfirmState<Target>,
): readonly [ConfirmState<Target>, Target] | undefined =>
	state._tag === "Confirming" ? [{ _tag: "Running", target: state.target }, state.target] : undefined

/** The action failed: ask again, so the user can retry or cancel. */
export const failed = <Target>(state: ConfirmState<Target>): ConfirmState<Target> =>
	state._tag === "Running" ? { _tag: "Confirming", target: state.target } : state

/** Cancelled (Escape, the backdrop, Cancel): closed, unless the action already runs and settles itself. */
export const cancel = <Target>(state: ConfirmState<Target>): ConfirmState<Target> =>
	state._tag === "Confirming" ? closed : state

export interface ConfirmDialogOptions<Msg> {
	readonly key: string
	readonly title: string
	readonly description: string
	readonly confirmLabel: string
	/** The confirm button while the action runs ("Deleting..."). */
	readonly runningLabel: string
	readonly destructive?: boolean
	readonly confirmed: Msg
	readonly cancelled: Msg
}

/** The dialog for `state`: open while it holds a target, its confirm pending while the action runs. */
export const confirmDialog = <Msg, Target>(
	h: Hazel.H<Msg>,
	state: ConfirmState<Target>,
	options: ConfirmDialogOptions<Msg>,
) => {
	const isRunning = state._tag === "Running"
	return h.dialog
		.key(options.key)
		.open(state._tag !== "Closed")
		.title(options.title)
		.description(options.description)
		.destructive(options.destructive ?? true)
		.actions(
			h.button.key("cancel").label("Cancel").variant("outline").on("press", options.cancelled),
			h.button
				.key("confirm")
				.label(isRunning ? options.runningLabel : options.confirmLabel)
				.variant(options.destructive === false ? "primary" : "danger")
				.loading(isRunning)
				.disabled(isRunning)
				.on("press", options.confirmed),
		)
		.on("dismiss", options.cancelled)
}
