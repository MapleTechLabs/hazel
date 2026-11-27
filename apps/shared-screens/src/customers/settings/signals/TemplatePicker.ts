// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * "New signal" (today's `picker-view.ts`, Wonder `you`): pick a template; thresholds, scope and
 * severity come on the next step. Mounted while open, so it starts fresh each time.
 */
import { UiSchema } from "@effect/ui"
import { requiredSourcesOf } from "@hazel/customer-integrations"
import * as Customers from "@hazel/domain/customers"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { Navigate } from "../../../app/requests"
import { sourcesLabel } from "../../data/providers"
import { sourceLogo } from "../../ui/identity"
import { TEMPLATE_BLURB, TEMPLATE_ICON } from "./describe"
import { isAvailable, PickerKind, RuleRow, TEMPLATE_ORDER } from "./model"
import { newRuleHref } from "./parts"

export const TemplatePickerProps = Schema.Struct({
	orgSlug: Schema.String,
	rules: Schema.Array(RuleRow),
	providers: Schema.NullOr(Schema.Array(Customers.CustomerProvider)),
})
export type TemplatePickerProps = typeof TemplatePickerProps.Type

export const TemplatePickerModel = Schema.Struct({
	search: TextField.State,
	kind: PickerKind,
	selected: Schema.NullOr(Customers.SignalTemplate),
})
export type TemplatePickerModel = typeof TemplatePickerModel.Type

export const TemplatePickerMessage = UiSchema.TaggedEnum({
	ChangedSearch: { payload: TextField.ChangePayload },
	PickedKind: { selected: Schema.Array(Schema.String) },
	PickedTemplate: { selected: Schema.Array(Schema.String) },
	PressedSetUp: {},
	PressedCancel: {},
	DismissedDialog: {},
})
export type TemplatePickerMessage = typeof TemplatePickerMessage.Type

export const TemplatePickerEvents = UiSchema.TaggedEnum({ RequestedClose: {} })
export type TemplatePickerEvents = typeof TemplatePickerEvents.Type

const matchesSearch = (template: Customers.SignalTemplate, search: string): boolean => {
	const query = search.trim().toLowerCase()
	return (
		query === "" ||
		Customers.TEMPLATES[template].name.toLowerCase().includes(query) ||
		TEMPLATE_BLURB[template].toLowerCase().includes(query)
	)
}

/** How many rules a template backs, on its card. */
const usedBy = (rules: ReadonlyArray<RuleRow>, template: Customers.SignalTemplate): number | undefined => {
	const count = rules.filter((rule) => rule.template === template).length
	return count === 0 ? undefined : count
}

/** The card's second line: what it looks for, or the source it waits for. */
// HAZEL-GAP(pk7-template-card-footer): today a card names its kind after the title and ends in its sources and usage (`Used by 2 rules`), or "Requires <source>" and a Connect link.
const detailOf = (props: TemplatePickerProps, template: Customers.SignalTemplate): string =>
	isAvailable(props.providers, template)
		? TEMPLATE_BLURB[template]
		: `Requires ${sourcesLabel(requiredSourcesOf(template))}`

const kindCount = (kind: Customers.SignalKind) =>
	TEMPLATE_ORDER.filter((template) => Customers.TEMPLATES[template].kind === kind).length

const isKind = Schema.is(PickerKind)
const isTemplate = Schema.is(Customers.SignalTemplate)

const TemplatePickerDef = Hazel.component({
	name: "TemplatePicker",
	props: TemplatePickerProps,
	model: TemplatePickerModel,
	message: TemplatePickerMessage,
	events: TemplatePickerEvents,
})

const close = TemplatePickerEvents.RequestedClose()

export const TemplatePicker = TemplatePickerDef.make({
	init: () => ({ search: TextField.empty, kind: "all" as const, selected: null }),
	update: {
		ChangedSearch: ($, { payload }) =>
			$.evolve({ search: (search) => TextField.changed(search, payload) }),
		PickedKind: ($, { selected }) => {
			const kind = selected.find((value) => value !== $.model.kind)
			return kind !== undefined && isKind(kind) ? $.evolve({ kind }) : $.model
		},
		PickedTemplate: ($, { selected }) => {
			const template = selected.find((value) => value !== $.model.selected)
			return template !== undefined && isTemplate(template) && isAvailable($.props.providers, template)
				? $.evolve({ selected: template })
				: $.model
		},
		PressedSetUp: ($) =>
			$.model.selected === null
				? $.model
				: $.run(
						Navigate.make({
							href: newRuleHref($.props.orgSlug, $.model.selected),
							replace: false,
						}),
					).emit(close),
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
	},
	view: (h, model) => {
		const { props } = h
		const shown = TEMPLATE_ORDER.filter(
			(template) =>
				(model.kind === "all" || Customers.TEMPLATES[template].kind === model.kind) &&
				matchesSearch(template, model.search.text),
		)
		const selected = model.selected
		const connected = props.providers ?? []
		// HAZEL-GAP(pk7-picker-width): today's dialog is `4xl` (896px) with two columns of cards.
		return h.dialog
			.open(true)
			.title("New signal")
			.description(
				"Pick a template. You set thresholds, scope and severity on the next step, with a live preview.",
			)
			.on("dismiss", TemplatePickerMessage.DismissedDialog())
			.children(
				h.stack
					.key("controls")
					.axis("horizontal")
					.wrap()
					.align("center")
					.density("cozy")
					.children(
						h.searchField
							.placeholder("Search templates…")
							.width("regular")
							.value(model.search)
							.on("change", (payload) => TemplatePickerMessage.ChangedSearch({ payload })),
						h.choiceGroup
							.label("Kind")
							.labelHidden()
							.style("segmented")
							.options([
								{ value: "all", label: `All ${TEMPLATE_ORDER.length}` },
								{ value: "risk", label: `Risk ${kindCount("risk")}` },
								{ value: "opportunity", label: `Opportunity ${kindCount("opportunity")}` },
							])
							.selected([model.kind])
							.on("change", ({ selected: picked }) =>
								TemplatePickerMessage.PickedKind({ selected: picked }),
							),
						connected.length === 0
							? null
							: h.stack
									.axis("horizontal")
									.align("center")
									.density("snug")
									.children(
										h.text.role("caption").tone("muted").children("Connected"),
										...connected.map((provider) => sourceLogo(h, provider).key(provider)),
									),
					),
				shown.length === 0
					? h.emptyState.key("none").title("No template matches that search.")
					: h.choiceGroup
							.key("templates")
							.label("Templates")
							.labelHidden()
							.style("cards")
							.columns("2")
							.options(
								shown.map((template) => ({
									value: template,
									label: Customers.TEMPLATES[template].name,
									description: detailOf(props, template),
									icon: TEMPLATE_ICON[template],
									badge: usedBy(props.rules, template),
									disabled: !isAvailable(props.providers, template),
								})),
							)
							.selected(selected === null ? [] : [selected])
							.on("change", ({ selected: picked }) =>
								TemplatePickerMessage.PickedTemplate({ selected: picked }),
							),
				h.text
					.key("hint")
					.role("caption")
					.tone("muted")
					.children(
						"A template can back several rules, e.g. a stricter Stopped using the product just for your largest accounts.",
					),
			)
			.actions(
				h.button
					.label("Cancel")
					.variant("outline")
					.on("press", TemplatePickerMessage.PressedCancel()),
				h.button
					.label(selected === null ? "Set up" : `Set up ${Customers.TEMPLATES[selected].name}`)
					.disabled(selected === null)
					.on("press", TemplatePickerMessage.PressedSetUp()),
			)
	},
})
