import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { button } from "../../../ui/button"
import { loader } from "../../../ui/loader"
import { textField } from "../../../ui/text-field"
import type { PageViewInputs } from "../../contract"
import { authError, authFailureMessage, authFrame, authHeading, signInLink } from "../layout"
import { Message } from "./message"
import { type Form, isFirstNameMissing, Model } from "./model"

const toFirstName = (value: string) => Message.ChangedFirstName({ value })
const toLastName = (value: string) => Message.ChangedLastName({ value })

const nameField = (
	h: HtmlBuilder<Message>,
	options: {
		readonly id: string
		readonly label: string
		readonly value: string
		readonly autocomplete: string
		readonly isRequired: boolean
		readonly error: string | null
		readonly isAutoFocused: boolean
		readonly onInput: (value: string) => Message
	},
): Html =>
	textField(
		h,
		{
			id: options.id,
			value: options.value,
			isRequired: options.isRequired,
			isInvalid: options.error !== null,
			onInput: options.onInput,
		},
		(parts) => [
			parts.label([options.label]),
			parts.input({
				attributes: [
					h.Attribute("autocomplete", options.autocomplete),
					...(options.isAutoFocused ? [h.Autofocus(true)] : []),
				],
			}),
			parts.fieldError([options.error ?? ""]),
		],
	)

const nameForm = (h: HtmlBuilder<Message>, form: Form): Html => {
	const isSubmitting = form.submission._tag === "Submitting"
	return h.form(
		[h.Class("flex flex-col gap-4"), h.OnSubmit(Message.SubmittedRegistration())],
		[
			nameField(h, {
				id: "register-first-name",
				label: "First name",
				value: form.firstName,
				autocomplete: "given-name",
				isRequired: true,
				error:
					form.submission._tag !== "NotSubmitted" && isFirstNameMissing(form)
						? "Enter your first name"
						: null,
				isAutoFocused: true,
				onInput: toFirstName,
			}),
			nameField(h, {
				id: "register-last-name",
				label: "Last name",
				value: form.lastName,
				autocomplete: "family-name",
				isRequired: false,
				error: null,
				isAutoFocused: false,
				onInput: toLastName,
			}),
			button(
				h,
				{
					intent: "primary",
					className: "mt-2 w-full",
					isDisabled: isSubmitting,
					onPress: Message.SubmittedRegistration(),
				},
				isSubmitting
					? [loader(h, { className: "size-4" }), "Creating your account..."]
					: ["Continue"],
			),
		],
	)
}

const brokenLink = (h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
	authHeading(
		h,
		"This sign-up link doesn't work",
		"It's missing details from your sign-in. Start again to continue.",
	),
	signInLink(h, "Back to sign in"),
]

const registration = (h: HtmlBuilder<Message>, form: Form): ReadonlyArray<Html> => {
	const failure = form.submission._tag === "Failed" ? authFailureMessage(form.submission.reason) : null
	return [
		authHeading(h, "Welcome to Hazel", "What should your teammates call you?"),
		nameForm(h, form),
		...(failure === null
			? []
			: [
					authError(h, failure) ?? h.empty,
					h.p([h.Class("mt-2")], [signInLink(h, "Start sign-in again")]),
				]),
	]
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	authFrame(
		h,
		shared.nowMs,
		Model.match(model, {
			BrokenLink: () => brokenLink(h),
			Ready: ({ form }) => registration(h, form),
		}),
	),
)
