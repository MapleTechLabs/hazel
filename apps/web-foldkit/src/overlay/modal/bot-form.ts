import { ApiScope } from "@hazel/domain/scopes"
import { Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { BOT_SCOPES } from "~/lib/bot-scopes"
import { checkbox } from "../../ui/checkbox"
import { description, label } from "../../ui/field"
import { switchControl } from "../../ui/switch"
import { textField } from "../../ui/text-field"

/** The form shared by `create-bot-modal.tsx` and `edit-bot-modal.tsx` (same fields, same schema). */

export const BotFormFields = {
	name: Schema.String,
	/** Validated on change only (tanstack-form `onChange`), so null until the first edit or submit. */
	nameError: Schema.NullOr(Schema.String),
	description: Schema.String,
	scopes: Schema.Array(ApiScope),
	isPublic: Schema.Boolean,
	isSubmitting: Schema.Boolean,
}
const BotForm = Schema.Struct(BotFormFields)
export type BotForm = typeof BotForm.Type

export const initBotForm = (
	values: Pick<BotForm, "name" | "description" | "scopes" | "isPublic">,
): BotForm => ({
	...values,
	nameError: null,
	isSubmitting: false,
})

/** arktype `name: "1<string<101"` (the API's rule), worded for the user. */
export const validateBotName = (name: string) =>
	name.length < 2
		? "Name must be at least 2 characters"
		: name.length > 100
			? "Name must be 100 characters or less"
			: null

// Spread, not modifyFields: it cannot evolve a generic model. Every change revalidates the schema.
export const changedName = <M extends BotForm>(model: M, value: string): M => ({
	...model,
	name: value,
	nameError: validateBotName(value),
})

export const changedDescription = <M extends BotForm>(model: M, value: string): M => ({
	...model,
	description: value,
	nameError: validateBotName(model.name),
})

export const toggledScope = <M extends BotForm>(model: M, scope: ApiScope): M => ({
	...model,
	scopes: model.scopes.includes(scope)
		? model.scopes.filter((item) => item !== scope)
		: [...model.scopes, scope],
	nameError: validateBotName(model.name),
})

export const toggledPublic = <M extends BotForm>(model: M, isSelected: boolean): M => ({
	...model,
	isPublic: isSelected,
	nameError: validateBotName(model.name),
})

/** tanstack-form `canSubmit`: only schema errors disable submit; empty scopes do not. */
export const isBotSubmitDisabled = (model: BotForm) => model.nameError !== null || model.isSubmitting

/** Submit validates the schema, then legacy `onSubmit` returns early without scopes. */
export const submittedBotForm = <M extends BotForm>(
	model: M,
): { readonly model: M; readonly isReady: boolean } => {
	const nameError = validateBotName(model.name)
	return {
		model: { ...model, nameError },
		isReady: nameError === null && model.scopes.length > 0 && !model.isSubmitting,
	}
}

export interface BotFormViewOptions<Message> {
	readonly id: string
	readonly form: BotForm
	readonly onName: (value: string) => Message
	readonly onDescription: (value: string) => Message
	readonly onToggleScope: (scope: ApiScope) => Message
	readonly onPublic: (isSelected: boolean) => Message
}

const scopeLabelClass =
	"flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"

/** The ModalBody children: name, description, permissions, advanced. */
export const botFormFields = <Message>(
	h: HtmlBuilder<Message>,
	options: BotFormViewOptions<Message>,
): Array<Html> => {
	const { form } = options
	const isNameInvalid = form.nameError !== null
	return [
		textField(
			h,
			{ id: `${options.id}-name`, value: form.name, onInput: options.onName, isInvalid: isNameInvalid },
			(field) => [
				field.label(["Name"]),
				field.input({ placeholder: "My bot" }),
				field.fieldError([form.nameError ?? ""]),
			],
		),
		textField(
			h,
			{ id: `${options.id}-description`, value: form.description, onInput: options.onDescription },
			(field) => [
				field.label(["Description"]),
				field.description(["Describe what this bot does"]),
				field.textarea({ placeholder: "This bot helps with...", attributes: [h.Rows(2)] }),
			],
		),
		h.div(
			[h.Class("flex flex-col gap-3")],
			[
				h.div(
					[],
					[label(h, {}, ["Permissions"]), description(h, {}, ["Select what this bot can access"])],
				),
				// The "Select at least one permission" FieldError has no field context, so React Aria never renders it.
				h.div(
					[h.Class("grid gap-2 sm:grid-cols-2")],
					BOT_SCOPES.map((scope) =>
						label(h, { className: scopeLabelClass }, [
							checkbox(
								h,
								{
									id: `${options.id}-scope-${scope.id}`,
									isSelected: form.scopes.includes(scope.id),
									onChange: () => options.onToggleScope(scope.id),
								},
								[],
							),
							h.div(
								[h.Class("flex flex-col gap-0.5")],
								[
									h.span([h.Class("font-medium text-fg text-sm")], [scope.label]),
									h.span([h.Class("text-muted-fg text-xs")], [scope.description]),
								],
							),
						]),
					),
				),
			],
		),
		h.div(
			[h.Class("flex flex-col gap-4 border-border border-t pt-4")],
			[
				h.div([h.Class("font-medium text-fg text-sm")], ["Advanced"]),
				h.div(
					[h.Class("flex items-center justify-between gap-4")],
					[
						h.div(
							[h.Class("flex flex-col gap-0.5")],
							[
								label(h, { className: "font-medium" }, ["List in Marketplace"]),
								description(h, {}, [
									"Allow other workspaces to discover and install this application",
								]),
							],
						),
						switchControl(
							h,
							{
								id: `${options.id}-public`,
								isSelected: form.isPublic,
								onChange: options.onPublic,
							},
							[],
						),
					],
				),
			],
		),
	]
}
