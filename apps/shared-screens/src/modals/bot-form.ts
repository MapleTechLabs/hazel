// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The form the create and edit bot modals share (the deleted Foldkit `overlay/modal/bot-form.ts`):
 * name, description, permissions and the marketplace switch, with the API's name rule.
 */
import { ApiScope } from "@hazel/domain/scopes"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import { TextField } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { BOT_SCOPES } from "../settings/integrations/scopes"

export const BotForm = Schema.Struct({
	name: TextField.State,
	description: TextField.State,
	scopes: Schema.Array(ApiScope),
	isPublic: Schema.Boolean,
	/** tanstack-form validates on change: no error shows until the first edit or submit. */
	touched: Schema.Boolean,
	submitting: Schema.Boolean,
})
export type BotForm = typeof BotForm.Type

export const initBotForm = (values: {
	readonly name: string
	readonly description: string
	readonly scopes: ReadonlyArray<ApiScope>
	readonly isPublic: boolean
}): BotForm => ({
	name: TextField.set(TextField.empty, values.name),
	description: TextField.set(TextField.empty, values.description),
	scopes: values.scopes,
	isPublic: values.isPublic,
	touched: false,
	submitting: false,
})

/** arktype `name: "1<string<101"` (the API's rule), worded for the user. */
export const validateBotName = (name: string) =>
	name.length < 2
		? "Name must be at least 2 characters"
		: name.length > 100
			? "Name must be 100 characters or less"
			: null

export const nameErrorOf = (form: BotForm) => (form.touched ? validateBotName(form.name.text) : null)

/** tanstack-form `canSubmit`: only schema errors disable submit; empty scopes do not. */
export const isBotSubmitDisabled = (form: BotForm) => nameErrorOf(form) !== null || form.submitting

/** Legacy `onSubmit` returns early without scopes. */
export const isBotReady = (form: BotForm) =>
	validateBotName(form.name.text) === null && form.scopes.length > 0 && !form.submitting

const isScope = Schema.is(ApiScope)

/** Only the scopes the permissions list knows, as legacy keeps them. */
export const knownScopes = (scopes: ReadonlyArray<string>): ReadonlyArray<ApiScope> =>
	scopes.filter(
		(scope): scope is ApiScope => isScope(scope) && BOT_SCOPES.some((known) => known.id === scope),
	)

export interface BotFormMessages<Msg> {
	readonly name: (payload: TextField.ChangePayload) => Msg
	readonly description: (payload: TextField.ChangePayload) => Msg
	readonly scopes: (selected: ReadonlyArray<string>) => Msg
	readonly isPublic: (checked: boolean) => Msg
}

/** The fields, in today's order. */
export const botFormView = <Msg>(h: Hazel.H<Msg>, form: BotForm, on: BotFormMessages<Msg>) => [
	h.textField
		.label("Name")
		.placeholder("My bot")
		.value(form.name)
		.error(nameErrorOf(form) ?? undefined)
		.on("change", on.name),
	h.textArea
		.label("Description")
		.description("Describe what this bot does")
		.placeholder("This bot helps with...")
		.value(form.description)
		.on("change", on.description),
	h.choiceGroup
		.label("Permissions")
		.description("Select what this bot can access")
		.style("cards")
		.columns("2")
		.multiple()
		.options(
			BOT_SCOPES.map((scope) => ({
				value: scope.id,
				label: scope.label,
				description: scope.description,
			})),
		)
		.selected(form.scopes)
		.on("change", ({ selected }) => on.scopes(selected)),
	h.divider,
	// HAZEL-GAP(po2-form-subheading): today "Advanced" is a 14px medium label over the row, no heading level.
	h.text.strong().children("Advanced"),
	h.toggle
		.label("List in Marketplace")
		.description("Allow other workspaces to discover and install this application")
		.checked(form.isPublic)
		.on("change", ({ checked }) => on.isPublic(checked)),
]

/** Every change revalidates the whole form, as tanstack-form does. */
export const changedBotForm = <F extends BotForm>(form: F, change: Partial<BotForm>): F => ({
	...form,
	...change,
	touched: true,
})

export const scopesOf = (selected: ReadonlyArray<string>): ReadonlyArray<ApiScope> => selected.filter(isScope)
