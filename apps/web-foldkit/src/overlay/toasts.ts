import { Schema } from "effect"

/** The toast request pages, modals and the palette send (sonner's options); the slot is `toaster.ts`. */

/** What a toast's action button asks the root to do. */
export const ToastAction = Schema.Literals(["InstallUpdate"])
export type ToastAction = typeof ToastAction.Type

export const ToastRequest = Schema.Struct({
	intent: Schema.Literals(["success", "error", "info", "warning", "loading"]),
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	/** Sonner's `id`: a later toast with the same id replaces this one (loading, then success). */
	id: Schema.optionalKey(Schema.String),
	/** sonner's `action`: a button that reports `key` to the root and closes the toast. */
	action: Schema.optionalKey(Schema.Struct({ label: Schema.String, key: ToastAction })),
	/** Stays until dismissed (sonner's `duration: Infinity`). */
	isSticky: Schema.optionalKey(Schema.Boolean),
})
export type ToastRequest = typeof ToastRequest.Type
