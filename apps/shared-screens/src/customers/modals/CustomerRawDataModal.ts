// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * "View raw data" from the customer page's More menu (today's `rawDialog` in
 * `page/customers/detail/view.ts`): the account as Hazel stores it, with its source links.
 */
import { UiSchema } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { ModalEvents } from "../../modals/feedback"

export const CustomerRawDataProps = Schema.Struct({ json: Schema.String })
export type CustomerRawDataProps = typeof CustomerRawDataProps.Type

export const CustomerRawDataMessage = UiSchema.TaggedEnum({ PressedClose: {}, DismissedDialog: {} })
export type CustomerRawDataMessage = typeof CustomerRawDataMessage.Type

const close = ModalEvents.RequestedClose()

export const CustomerRawDataModal = Hazel.component({
	name: "CustomerRawDataModal",
	props: CustomerRawDataProps,
	model: Schema.Struct({}),
	message: CustomerRawDataMessage,
	events: ModalEvents,
}).make({
	init: () => ({}),
	update: {
		PressedClose: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
	},
	// HAZEL-GAP(pk5-dialog-size): today's dialog is the kit's `lg` size with the JSON capped at 60vh.
	view: (h) =>
		h.dialog
			.open(true)
			.title("Raw data")
			.description("The account as Hazel stores it, with its source links.")
			.on("dismiss", CustomerRawDataMessage.DismissedDialog())
			.children(h.codeBlock.language("json").code(h.props.json))
			.actions(
				h.button.label("Close").variant("outline").on("press", CustomerRawDataMessage.PressedClose()),
			),
})
