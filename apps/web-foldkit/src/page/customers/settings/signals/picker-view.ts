import * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { PROVIDERS, sourcesLabel } from "../../../../customers/providers"
import { KIND_LABEL } from "../../../../customers/ui/badges"
import { searchBox, segmented } from "../../../../customers/ui/filter-bar"
import { sourceLogo } from "../../../../customers/ui/identity"
import { IconCheck } from "../../../../icons"
import { AppRoute, hrefOf } from "../../../../route"
import { button } from "../../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader } from "../../../../ui/dialog"
import * as Modal from "../../../../ui/modal"
import type { Shared } from "../../../contract"
import { TEMPLATE_BLURB } from "./describe"
import { Message } from "./message"
import { isAvailable, type Model, type PickerKind, TEMPLATE_ORDER } from "./model"
import { templateTile } from "./parts"

/** "New signal" (Wonder `you`): pick a template; thresholds, scope and severity come on the next step. */

type H = HtmlBuilder<Message>

const toModalMessage = (message: Modal.Message) => Message.GotPickerModalMessage({ message })
const toSearch = (value: string) => Message.ChangedPickerSearch({ value })
const toKind = (kind: PickerKind) => Message.ClickedPickerKind({ kind })

export const SEARCH_ID = "signals-template-search"

const matchesSearch = (template: Customers.SignalTemplate, search: string): boolean => {
	const query = search.trim().toLowerCase()
	return (
		query === "" ||
		Customers.TEMPLATES[template].name.toLowerCase().includes(query) ||
		TEMPLATE_BLURB[template].toLowerCase().includes(query)
	)
}

/** `Used by 2 rules`, `1 rule, off`, `Not used yet`. */
const usageOf = (model: Model, template: Customers.SignalTemplate): string => {
	const rules = (model.rules ?? []).filter((rule) => rule.template === template)
	const on = rules.filter((rule) => rule.enabled).length
	const word = (count: number) => `${count} ${count === 1 ? "rule" : "rules"}`
	return rules.length === 0
		? "Not used yet"
		: on === 0
			? `${word(rules.length)}, off`
			: `Used by ${word(on)}`
}

const sources = (h: H, template: Customers.SignalTemplate): Html => {
	const required = Customers.TEMPLATES[template].requiredSources
	return h.span(
		[h.Class("flex min-w-0 items-center gap-1.5 text-muted-fg text-xs")],
		required.length === 0
			? [sourceLogo(h, "hazel", "size-4"), "Built in"]
			: [...required.map((source) => sourceLogo(h, source, "size-4")), sourcesLabel(required)],
	)
}

const kindTag = (h: H, kind: Customers.SignalKind): Html =>
	h.span(
		[
			h.Class(
				twMerge(
					"font-medium text-xs",
					kind === "risk" ? "text-danger-subtle-fg" : "text-info-subtle-fg",
				),
			),
		],
		[KIND_LABEL[kind]],
	)

const cardHead = (h: H, template: Customers.SignalTemplate): ReadonlyArray<Html> => {
	const meta = Customers.TEMPLATES[template]
	return [
		templateTile(h, template, "size-9"),
		h.span(
			[h.Class("flex min-w-0 flex-1 flex-col gap-0.5")],
			[
				h.span(
					[h.Class("flex flex-wrap items-center gap-2")],
					[h.span([h.Class("font-semibold text-fg text-sm")], [meta.name]), kindTag(h, meta.kind)],
				),
				h.span([h.Class("text-muted-fg text-sm")], [TEMPLATE_BLURB[template]]),
			],
		),
	]
}

const templateCard = (h: H, model: Model, template: Customers.SignalTemplate, orgSlug: string): Html => {
	const required = Customers.TEMPLATES[template].requiredSources
	if (!isAvailable(model, template)) {
		const first = required[0]
		return h.div(
			[h.Class("flex flex-col gap-3 rounded-xl border border-border border-dashed p-4")],
			[
				h.div([h.Class("flex items-start gap-3 opacity-60")], [...cardHead(h, template)]),
				h.div(
					[h.Class("flex items-center justify-between gap-2 text-xs")],
					[
						h.span(
							[h.Class("flex items-center gap-1.5 font-medium text-warning-subtle-fg")],
							[
								...required.map((source) => sourceLogo(h, source, "size-4")),
								`Requires ${sourcesLabel(required)}`,
							],
						),
						...(first === undefined
							? []
							: [
									h.a(
										[
											h.Href(
												hrefOf(
													AppRoute.CustomersSourceDetail({
														orgSlug,
														provider: first,
													}),
												),
											),
											h.Class("font-medium text-primary hover:underline"),
										],
										[`Connect ${PROVIDERS[first].name}`],
									),
								]),
					],
				),
			],
		)
	}
	const isSelected = model.picker.selected === template
	return h.button(
		[
			h.Type("button"),
			h.Role("radio"),
			h.AriaChecked(isSelected),
			h.OnClick(Message.ClickedTemplate({ template })),
			h.Class(
				twMerge(
					"relative flex cursor-pointer flex-col gap-3 rounded-xl border border-border p-4 text-left outline-hidden transition-colors hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring/70",
					isSelected && "border-primary bg-primary-subtle/30 hover:bg-primary-subtle/30",
				),
			),
		],
		[
			h.span([h.Class("flex items-start gap-3")], [...cardHead(h, template)]),
			h.span(
				[h.Class("flex items-center justify-between gap-2")],
				[
					sources(h, template),
					h.span([h.Class("shrink-0 text-muted-fg text-xs")], [usageOf(model, template)]),
				],
			),
			...(isSelected
				? [
						h.span(
							[
								h.AriaHidden(true),
								h.Class(
									"absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-fg",
								),
							],
							[IconCheck(h, { className: "size-3" })],
						),
					]
				: []),
		],
	)
}

export const pickerModal = (h: H, model: Model, shared: Shared): Html =>
	Modal.controlledModal(h, {
		model: model.pickerModal,
		toParentMessage: toModalMessage,
		size: "4xl",
		toContent: (closeAttributes) => {
			const { picker } = model
			const count = (kind: Customers.SignalKind) =>
				TEMPLATE_ORDER.filter((template) => Customers.TEMPLATES[template].kind === kind).length
			const shown = TEMPLATE_ORDER.filter(
				(template) =>
					(picker.kind === "all" || Customers.TEMPLATES[template].kind === picker.kind) &&
					matchesSearch(template, picker.search),
			)
			const selected = picker.selected
			return [
				dialogHeader(h, {
					title: { id: Modal.titleId(model.pickerModal.id), text: "New signal" },
					description:
						"Pick a template. You set thresholds, scope and severity on the next step, with a live preview.",
				}),
				dialogBody(h, [
					h.div(
						[h.Class("flex flex-col gap-4")],
						[
							h.div(
								[h.Class("flex flex-wrap items-center gap-3")],
								[
									searchBox(h, {
										id: SEARCH_ID,
										value: picker.search,
										placeholder: "Search templates…",
										onInput: toSearch,
										onClear: Message.ClearedPickerSearch(),
									}),
									segmented(h, {
										ariaLabel: "Kind",
										segments: [
											{ key: "all", label: `All ${TEMPLATE_ORDER.length}` },
											{ key: "risk", label: `Risk ${count("risk")}` },
											{
												key: "opportunity",
												label: `Opportunity ${count("opportunity")}`,
											},
										],
										selected: picker.kind,
										onSelect: toKind,
									}),
									...(model.connectedProviders === null ||
									model.connectedProviders.length === 0
										? []
										: [
												h.span(
													[
														h.Class(
															"ml-auto flex items-center gap-1.5 text-muted-fg text-xs",
														),
													],
													[
														"Connected",
														...model.connectedProviders.map((provider) =>
															h.span(
																[h.Title(PROVIDERS[provider].name)],
																[sourceLogo(h, provider, "size-4")],
															),
														),
													],
												),
											]),
								],
							),
							shown.length === 0
								? h.p(
										[h.Class("py-8 text-center text-muted-fg text-sm")],
										["No template matches that search."],
									)
								: h.div(
										[
											h.Role("radiogroup"),
											h.AriaLabel("Templates"),
											h.Class("grid gap-3 sm:grid-cols-2"),
										],
										shown.map((template) =>
											templateCard(h, model, template, shared.orgSlug ?? ""),
										),
									),
						],
					),
				]),
				dialogFooter(h, [
					h.p(
						[h.Class("mr-auto max-w-sm text-muted-fg text-xs")],
						[
							"A template can back several rules, e.g. a stricter Stopped using the product just for your largest accounts.",
						],
					),
					dialogClose(h, closeAttributes, ["Cancel"]),
					button(h, { onPress: Message.PressedSetUpTemplate(), isDisabled: selected === null }, [
						selected === null ? "Set up" : `Set up ${Customers.TEMPLATES[selected].name}`,
					]),
				]),
			]
		},
	})
