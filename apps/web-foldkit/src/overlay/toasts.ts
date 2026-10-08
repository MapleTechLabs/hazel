import { Schema } from "effect"

/** The toast request pages, modals and the palette send (sonner's options); the slot is `toaster.ts`. */

export const ToastRequest = Schema.Struct({
	intent: Schema.Literals(["success", "error", "info", "warning", "loading"]),
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	/** Sonner's `id`: a later toast with the same id replaces this one (loading, then success). */
	id: Schema.optionalKey(Schema.String),
})
export type ToastRequest = typeof ToastRequest.Type
