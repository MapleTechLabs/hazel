import { Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import * as Select from "../../ui/select"
import { view as selectView } from "../../ui/select-view"
import { textField } from "../../ui/text-field"
import { closed, completed } from "../out-message"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalDescription, modalTitle } from "./frame"
import { successToast } from "../../data/actions"

/**
 * `components/modals/feedback-modal.tsx` (user menu). Legacy submits to posthog only, which is
 * skipped here: submitting validates, then closes with the success toast.
 */

const Model = Schema.Struct({
	frame: Frame,
	category: Select.Model,
	message: Schema.String,
	/** tanstack-form `onChange` validation: null until the first change or submit. */
	messageError: Schema.NullOr(Schema.String),
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	GotCategoryMessage: { message: Select.Message },
	ChangedMessage: { value: Schema.String },
	ClickedCancel: {},
	SubmittedForm: {},
})
type Message = typeof Message.Type

/** arktype `message: "string >= 6"`, worded as arktype reports it. */
const validateMessage = (message: string) =>
	message.length >= 6 ? null : `message must be at least length 6 (was ${message.length})`

const ID = "feedback-modal"

type Return = ModalReturn<Model, Message>

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		GotCategoryMessage: ({ message }) => {
			const result = Select.update(model.category, message)
			// The form-level validator reruns on any field change.
			const messageError = result.outMessage === undefined ? model.messageError : validateMessage(model.message)
			return {
				model: modifyFields(model, { category: () => result.model, messageError: () => messageError }),
				commands: Command.mapMessages(result.commands, (child) => Message.GotCategoryMessage({ message: child })),
			}
		},
		ChangedMessage: ({ value }) => ({
			model: modifyFields(model, { message: () => value, messageError: () => validateMessage(value) }),
		}),
		ClickedCancel: () => ({ model, outMessage: closed }),
		SubmittedForm: () => {
			const messageError = validateMessage(model.message)
			return messageError === null
				? { model, outMessage: completed({ toast: successToast("Thank you for your feedback!") }) }
				: { model: modifyFields(model, { messageError: () => messageError }) }
		},
	})

const toCategoryMessage = (message: Select.Message): Message => Message.GotCategoryMessage({ message })

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, "Send Feedback"),
				modalDescription(h, "Help us improve by sharing your thoughts, reporting bugs, or requesting features."),
			]),
			h.form(
				[h.OnSubmit(Message.SubmittedForm())],
				[
					dialogBody(
						h,
						[
							textField(h, { id: `${ID}-category`, value: "" }, (field) => [
								field.label(["Category"]),
								h.submodel({
									slotId: `${ID}-category-select`,
									model: model.category,
									view: selectView,
									viewInputs: {},
									toParentMessage: toCategoryMessage,
								}),
							]),
							textField(
								h,
								{
									id: `${ID}-message`,
									value: model.message,
									onInput: (value) => Message.ChangedMessage({ value }),
								},
								(field) => [
									field.label(["Message"]),
									field.textarea({
										placeholder: "Describe your feedback in detail...",
										attributes: [h.Attribute("aria-invalid", model.messageError !== null ? "true" : "false")],
									}),
									// Only the textarea is invalid: React Aria never renders the FieldError here.
								],
							),
						],
						"flex flex-col gap-4",
					),
					dialogFooter(h, [
						button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
						button(
							h,
							{ intent: "primary", isDisabled: model.messageError !== null, attributes: [h.Type("submit")] },
							["Submit Feedback"],
						),
					]),
				],
			),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"Feedback",
	{ request: Requests.Feedback, Model, Message },
	{
		init: () => ({
			model: {
				frame: initFrame(ID),
				category: Select.init({
					id: `${ID}-category-select`,
					items: [
						Select.item("bug", "Bug"),
						Select.item("feature_request", "Feature Request"),
						Select.item("question", "Question"),
					],
					selectedKey: "bug",
				}),
				message: "",
				messageError: null,
			},
		}),
		update,
		view,
	},
)
