import type { FormValues, Model } from "./model"

/** The legacy arktype schema (`firstName: "string > 0"`, ...) and its messages. */
export interface FormErrors {
	readonly firstName: string | null
	readonly lastName: string | null
}

const nonEmpty = (field: string, value: string) => (value.length > 0 ? null : `${field} must be non-empty`)

export const validate = (values: FormValues): FormErrors => ({
	firstName: nonEmpty("firstName", values.firstName),
	lastName: nonEmpty("lastName", values.lastName),
})

/** Form-level `onChange` validation: nothing shows until the first change. */
export const errorsOf = (model: Model): FormErrors =>
	model.isDirty ? validate(model.values) : { firstName: null, lastName: null }

export const canSubmit = (model: Model): boolean => {
	const errors = errorsOf(model)
	return errors.firstName === null && errors.lastName === null
}

/** `isDisabled={!canSubmit || isSubmitting || !isDirty}` */
export const isSaveDisabled = (model: Model): boolean =>
	!canSubmit(model) || model.isSubmitting || !model.isDirty

export const initialsOf = (firstName: string, lastName: string) =>
	`${firstName.charAt(0)}${lastName.charAt(0)}`
