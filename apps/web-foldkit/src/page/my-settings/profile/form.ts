import { anyInvalid, makeRules, Rule } from "foldkit/fieldValidation"
import type { FormValues, Model } from "./model"

/** `user.update` takes a non-empty first name and at most 100 characters for either name. */
export const firstNameRules = makeRules({
	required: "First name is required",
	rules: [Rule.maxLength(100, "First name must be at most 100 characters")],
})

export const lastNameRules = makeRules({
	required: "Last name is required",
	rules: [Rule.maxLength(100, "Last name must be at most 100 characters")],
})

export const valuesOf = (model: Model): FormValues => ({
	firstName: model.firstName.value,
	lastName: model.lastName.value,
	timezone: model.selectedTimezone,
})

/** Derived: the values differ from the ones the form started from (or last saved). */
export const isDirty = (model: Model): boolean =>
	model.firstName.value !== model.defaults.firstName ||
	model.lastName.value !== model.defaults.lastName ||
	model.selectedTimezone !== model.defaults.timezone

/** `isDisabled={!canSubmit || isSubmitting || !isDirty}` */
export const isSaveDisabled = (model: Model): boolean =>
	!isDirty(model) || model.save._tag === "Saving" || anyInvalid([model.firstName, model.lastName])
