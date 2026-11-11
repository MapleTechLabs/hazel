import { Option } from "effect"
import { modifyFields } from "foldkit/struct"
import type { RouteOf } from "../../../route"
import type { PageReturn } from "../../contract"
import { Register } from "./command"
import { Message } from "./message"
import { type Form, isFirstNameMissing, Model, Submission } from "./model"

type Return = PageReturn<Model, Message>

export const init = (route: RouteOf<"AuthRegister">): Return => ({
	model: Option.match(Option.all({ flowId: route.flowId, reference: route.reference }), {
		onNone: () => Model.BrokenLink(),
		onSome: ({ flowId, reference }) =>
			Model.Ready({
				form: {
					flowId,
					reference,
					firstName: "",
					lastName: "",
					submission: Submission.NotSubmitted(),
				},
			}),
	}),
})

const withForm = (model: Model, f: (form: Form) => { form: Form; commands?: Return["commands"] }): Return =>
	Model.match<Return>(model, {
		BrokenLink: () => ({ model }),
		Ready: ({ form }) => {
			const next = f(form)
			return { model: Model.Ready({ form: next.form }), commands: next.commands }
		},
	})

const setSubmission = (form: Form, submission: Submission): Form =>
	modifyFields(form, { submission: () => submission })

const submit = (form: Form) => {
	if (form.submission._tag === "Submitting") return { form }
	if (isFirstNameMissing(form)) return { form: setSubmission(form, Submission.Invalid()) }
	return {
		form: setSubmission(form, Submission.Submitting()),
		commands: [
			Register({
				flowId: form.flowId,
				reference: form.reference,
				firstName: form.firstName,
				lastName: form.lastName,
			}),
		],
	}
}

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		ChangedFirstName: ({ value }) =>
			withForm(model, (form) => ({ form: modifyFields(form, { firstName: () => value }) })),
		ChangedLastName: ({ value }) =>
			withForm(model, (form) => ({ form: modifyFields(form, { lastName: () => value }) })),
		SubmittedRegistration: () => withForm(model, submit),
		// Stays busy until the browser navigates away.
		LeftForApp: () => ({ model }),
		FailedRegistration: ({ reason }) =>
			withForm(model, (form) => ({ form: setSubmission(form, Submission.Failed({ reason })) })),
	})
