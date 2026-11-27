// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/settings/debug` (`web-foldkit/src/page/settings/debug`, now deleted): a production build
 * sends the visitor on to the general settings; the dev-only diagnostics were never ported, so a
 * dev build draws nothing.
 */
import { UiSchema } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { Navigate } from "../../../app/requests"

export const DebugProps = Schema.Struct({
	/** A production build: redirect on arrival. */
	production: Schema.Boolean,
	/** Where the redirect goes (`/:org/settings`). */
	generalHref: Schema.String,
})
export type DebugProps = typeof DebugProps.Type

export const DebugPage = Hazel.component({
	name: "DebugPage",
	props: DebugProps,
	model: Schema.Struct({}),
	message: UiSchema.TaggedEnum({}),
}).make({
	init: ($) =>
		$.props.production
			? $.set({}).run(Navigate.make({ href: $.props.generalHref, replace: true }))
			: $.set({}),
	update: {},
	view: (h) => h.stack.key("settings-debug"),
})
