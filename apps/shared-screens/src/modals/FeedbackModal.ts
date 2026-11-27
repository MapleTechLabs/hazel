// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Send feedback (the deleted Foldkit `overlay/modal/feedback.ts`, legacy `feedback-modal.tsx`). Legacy
 * submits to posthog only, which is skipped: a valid message closes with the thank-you toast.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { ModalEvents, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const FeedbackCategory = Schema.Literals(["bug", "feature_request", "question"])
export type FeedbackCategory = typeof FeedbackCategory.Type

export const FeedbackModel = Schema.Struct({
	category: FeedbackCategory,
	message: TextField.State,
	/** tanstack-form `onChange`: no error until the first change or submit. */
	touched: Schema.Boolean,
})
export type FeedbackModel = typeof FeedbackModel.Type

export const FeedbackMessage = UiSchema.TaggedEnum({
	ChangedCategory: { value: Schema.String },
	ChangedMessage: { payload: TextField.ChangePayload },
	PressedSubmit: {},
	PressedCancel: {},
	DismissedDialog: {},
})
export type FeedbackMessage = typeof FeedbackMessage.Type

/** arktype `message: "string >= 6"` (the API's rule), worded for the user. */
export const messageErrorOf = (model: FeedbackModel) =>
	model.touched && model.message.text.length < 6 ? "Feedback must be at least 6 characters" : null

export class ThankForFeedback extends Command.Service<ThankForFeedback>()("hazel/modals/ThankForFeedback", {
	args: {},
	success: Component.Noop,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				() =>
					run(toast(successToast("Thank you for your feedback!")).pipe(Effect.as(Component.noop))),
		),
	)
}

const close = ModalEvents.RequestedClose()
const isCategory = Schema.is(FeedbackCategory)

export const FeedbackModalNoDeps = Hazel.component({
	name: "FeedbackModal",
	props: Schema.Struct({}),
	model: FeedbackModel,
	message: FeedbackMessage,
	events: ModalEvents,
}).make({
	init: () => ({ category: "bug", message: TextField.empty, touched: false }),
	update: {
		// The form-level validator reruns on any field change.
		ChangedCategory: ($, { value }) =>
			isCategory(value) ? $.evolve({ category: value, touched: true }) : $.model,
		ChangedMessage: ($, { payload }) =>
			$.evolve({ message: (message) => TextField.changed(message, payload), touched: true }),
		PressedSubmit: ($) => {
			const touched = { ...$.model, touched: true }
			return messageErrorOf(touched) === null
				? $.run(ThankForFeedback.make({})).emit(close)
				: $.evolve({ touched: true })
		},
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
	},
	view: (h, model) => {
		const error = messageErrorOf(model)
		return h.dialog
			.open(true)
			.size("large")
			.title("Send feedback")
			.description("Help us improve by sharing your thoughts, reporting bugs, or requesting features.")
			.on("dismiss", FeedbackMessage.DismissedDialog())
			.children(
				h.select
					.label("Category")
					.options([
						{ value: "bug", label: "Bug" },
						{ value: "feature_request", label: "Feature request" },
						{ value: "question", label: "Question" },
					])
					.value(model.category)
					.on("change", ({ value }) => FeedbackMessage.ChangedCategory({ value })),
				h.textArea
					.label("Message")
					.placeholder("Describe your feedback in detail...")
					.value(model.message)
					.error(error ?? undefined)
					.on("change", (payload) => FeedbackMessage.ChangedMessage({ payload })),
			)
			.actions(
				h.button.label("Cancel").variant("outline").on("press", FeedbackMessage.PressedCancel()),
				h.button
					.label("Submit feedback")
					.disabled(error !== null)
					.on("press", FeedbackMessage.PressedSubmit()),
			)
	},
})

export const FeedbackModal = FeedbackModalNoDeps.pipe(Component.provide(ThankForFeedback.layer))
