// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A settings card's header (`page/settings/*`, `pageHeader` with icon, title and subtitle). Built only
 * from primitives; the card around it is a `frame`. A second screen wanting it makes it a primitive.
 */
import { Schema } from "effect"
import { Hazel } from "../vocabulary/index.ts"
import { IconName } from "../vocabulary/options.ts"

export const SettingsHeader = Hazel.composite({
	name: "SettingsHeader",
	props: Schema.Struct({ icon: IconName, title: Schema.String, subtitle: Schema.String }),
	view: (h, props) =>
		h.stack
			.axis("horizontal")
			.align("start")
			.children(
				h.icon.name(props.icon),
				h.stack
					.density("compact")
					.children(
						h.heading.level("3").children(props.title),
						h.text.tone("muted").children(props.subtitle),
					),
			),
})
