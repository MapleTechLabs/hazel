import * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { formatCount, formatDate, formatRelative } from "../../../../customers/format"
import { sourcesLabel } from "../../../../customers/providers"
import { KIND_LABEL, kindChip, severityChip } from "../../../../customers/ui/badges"
import { sourceLogo } from "../../../../customers/ui/identity"
import { IconPlus } from "../../../../icons"
import { AppRoute, hrefOf } from "../../../../route"
import { button } from "../../../../ui/button"
import { switchControl } from "../../../../ui/switch"
import type { Shared } from "../../../contract"
import { isCustomersAdmin, readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { conditionParts, plainText, scopeSummary } from "./describe"
import { configFormOf } from "./draft"
import { Message } from "./message"
import { currencyOf, isAvailable, type Model, type RuleRow, TEMPLATE_ORDER } from "./model"
import { templateTile } from "./parts"
import { pickerModal } from "./picker-view"

/** The rules list (Wonder `now`): what is on, what each rule looks for, and what it matches now. */

type H = HtmlBuilder<Message>

const toToggle = (ruleId: RuleRow["id"]) => (enabled: boolean) => Message.ToggledRule({ ruleId, enabled })

const GROUP_BLURB = {
	risk: "accounts likely to churn or contract",
	opportunity: "accounts ready to expand",
} as const satisfies Record<Customers.SignalKind, string>

export const metricNameOf =
	(model: Model) =>
	(key: string): string =>
		model.metrics.find((metric) => metric.key === key)?.name ?? key

// SUMMARY

const summary = (h: H, model: Model, rules: ReadonlyArray<RuleRow>, nowMs: number): Html => {
	const enabled = rules.filter((rule) => rule.enabled)
	const signals = model.signals ?? []
	const countOf = (status: Customers.SignalStatus) =>
		signals.filter((signal) => signal.status === status).length
	const accounts = new Set(
		signals
			.filter((signal) => signal.status === "open" || signal.status === "snoozed")
			.map((signal) => signal.accountId),
	).size
	const matches = enabled.reduce((sum, rule) => sum + rule.matchingCount, 0)
	const strong = (text: string) => h.strong([h.Class("font-semibold text-fg tabular-nums")], [text])
	const item = (children: ReadonlyArray<Html | string>) =>
		h.span([h.Class("inline-flex items-center gap-1 text-muted-fg text-sm")], [...children])
	const lastComputed = model.settings?.lastComputedAtMs ?? null
	return h.div(
		[
			h.Class(
				"flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-bg px-4 py-3 sm:px-5",
			),
		],
		[
			item([strong(`${enabled.length} of ${rules.length}`), "rules on"]),
			item([strong(formatCount(matches)), `matches across ${formatCount(accounts)} accounts`]),
			item([
				strong(`${formatCount(countOf("open"))} open`),
				`· ${formatCount(countOf("snoozed"))} snoozed · ${formatCount(countOf("dismissed"))} dismissed`,
			]),
			h.span(
				[h.Class("ml-auto text-muted-fg text-sm")],
				[
					lastComputed === null
						? "Not checked yet"
						: `Last checked ${formatRelative(new Date(lastComputed), new Date(nowMs))}`,
				],
			),
		],
	)
}

// ROWS

const COLUMNS =
	"grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 px-4 md:grid-cols-[auto_minmax(0,1fr)_7rem_9rem_8rem_8rem]"

const headerRow = (h: H): Html =>
	h.div(
		[h.AriaHidden(true), h.Class(twMerge(COLUMNS, "h-9 border-border border-b text-muted-fg text-xs"))],
		[
			h.span([], ["On"]),
			h.span([], ["Rule"]),
			h.span([h.Class("hidden md:block")], ["Severity"]),
			h.span([h.Class("hidden md:block")], ["Applies to"]),
			h.span([h.Class("hidden text-right md:block")], ["Matching now"]),
			h.span([h.Class("text-right")], ["Last triggered"]),
		],
	)

const requires = (h: H, rule: RuleRow, orgSlug: string): Html => {
	const required = Customers.TEMPLATES[rule.template].requiredSources
	const first = required[0]
	return h.span(
		[h.Class("col-span-2 hidden items-center justify-end gap-2 text-muted-fg text-sm md:flex")],
		[
			"Requires",
			h.span(
				[
					h.Class(
						"inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5 text-fg",
					),
				],
				[...required.map((source) => sourceLogo(h, source, "size-3.5")), sourcesLabel(required)],
			),
			...(first === undefined
				? []
				: [
						h.a(
							[
								h.Href(hrefOf(AppRoute.CustomersSourceDetail({ orgSlug, provider: first }))),
								h.Class("relative z-10 font-medium text-primary hover:underline"),
							],
							["Connect"],
						),
					]),
		],
	)
}

const ruleRow = (h: H, model: Model, rule: RuleRow, shared: Shared): Html => {
	const orgSlug = shared.orgSlug ?? ""
	const isAdmin = isCustomersAdmin(shared)
	const description = plainText(
		conditionParts(rule.template, configFormOf(rule.config), metricNameOf(model)),
	)
	const muted = rule.enabled ? "" : "opacity-60"
	return h.li(
		[h.Class(twMerge(COLUMNS, "relative min-h-16 py-3 transition-colors hover:bg-secondary/40"))],
		[
			h.span(
				[h.Class("relative z-10")],
				[
					switchControl(
						h,
						{
							id: `signal-rule-${rule.id}`,
							isSelected: rule.enabled,
							isDisabled: !isAdmin,
							onChange: toToggle(rule.id),
						},
						[h.span([h.Class("sr-only")], [`${rule.name} on`])],
					),
				],
			),
			h.div(
				[h.Class(twMerge("flex min-w-0 items-center gap-3", muted))],
				[
					templateTile(h, rule.template),
					h.div(
						[h.Class("flex min-w-0 flex-col")],
						[
							h.a(
								[
									h.Href(
										hrefOf(
											AppRoute.CustomersSettingsSignalRule({
												orgSlug,
												ruleId: rule.id,
											}),
										),
									),
									h.Class(
										"truncate font-medium text-fg text-sm outline-hidden after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/70",
									),
								],
								[rule.name],
							),
							h.span([h.Class("line-clamp-2 text-muted-fg text-xs")], [description]),
						],
					),
				],
			),
			h.span([h.Class(twMerge("hidden md:block", muted))], [severityChip(h, rule.severity)]),
			h.span(
				[h.Class(twMerge("hidden truncate text-fg-2 text-sm md:block", muted))],
				[scopeSummary(rule.scope, currencyOf(model))],
			),
			...(isAvailable(model, rule.template)
				? [
						h.span(
							[h.Class("hidden text-right text-sm md:block")],
							[
								!rule.enabled
									? h.span([h.Class("text-muted-fg")], ["—"])
									: rule.matchingCount === 0
										? h.span([h.Class("text-muted-fg")], ["None"])
										: h.a(
												[
													h.Href(hrefOf(AppRoute.CustomersAttention({ orgSlug }))),
													h.Class(
														"relative z-10 font-medium text-fg tabular-nums underline decoration-border underline-offset-4 hover:decoration-fg",
													),
												],
												[
													`${formatCount(rule.matchingCount)} ${rule.matchingCount === 1 ? "account" : "accounts"}`,
												],
											),
							],
						),
						h.span(
							[h.Class("text-right text-muted-fg text-sm tabular-nums")],
							[
								!rule.enabled
									? `Off · updated ${formatDate(new Date(rule.updatedAtMs), { now: new Date(shared.nowMs) })}`
									: rule.lastTriggeredAtMs === null
										? "Never"
										: formatRelative(
												new Date(rule.lastTriggeredAtMs),
												new Date(shared.nowMs),
											),
							],
						),
					]
				: [requires(h, rule, orgSlug)]),
		],
	)
}

const group = (
	h: H,
	model: Model,
	kind: Customers.SignalKind,
	rules: ReadonlyArray<RuleRow>,
	shared: Shared,
) =>
	rules.length === 0
		? []
		: [
				h.section(
					[h.AriaLabel(`${KIND_LABEL[kind]} rules`), h.Class("flex flex-col gap-2")],
					[
						h.div(
							[h.Class("flex items-center gap-2 text-muted-fg text-sm")],
							[
								kindChip(h, kind),
								`${rules.length} ${rules.length === 1 ? "rule" : "rules"} · ${GROUP_BLURB[kind]}`,
							],
						),
						h.div(
							[h.Class("overflow-hidden rounded-xl border border-border bg-bg")],
							[
								headerRow(h),
								h.ul(
									[h.Class("divide-y divide-border")],
									rules.map((rule) => ruleRow(h, model, rule, shared)),
								),
							],
						),
					],
				),
			]

const byTemplate = (left: RuleRow, right: RuleRow) =>
	TEMPLATE_ORDER.indexOf(left.template) - TEMPLATE_ORDER.indexOf(right.template)

export const listView = (h: H, model: Model, shared: Shared): Html => {
	const isAdmin = isCustomersAdmin(shared)
	const rules = [...(model.rules ?? [])].sort(byTemplate)
	const accounts = model.accounts?.length ?? 0
	return h.div(
		[h.Class("h-full")],
		[
			settingsPage(h, [
				settingsHeader(h, {
					title: "Signals",
					subtitle: `Rules that put customers in Needs attention. Checked every hour against all ${formatCount(accounts)} accounts, including silent ones.`,
					actions: isAdmin
						? [
								button(h, { onPress: Message.PressedNewSignal() }, [
									IconPlus(h, { attributes: { "data-slot": "icon" } }),
									"New signal",
								]),
							]
						: [],
				}),
				...(isAdmin ? [] : [readOnlyNotice(h, "signal rules")]),
				...(model.rules === null
					? [
							h.div(
								[
									h.Class(
										"rounded-xl border border-border bg-bg px-5 py-10 text-center text-muted-fg text-sm",
									),
								],
								["Loading rules…"],
							),
						]
					: [
							summary(h, model, rules, shared.nowMs),
							...group(
								h,
								model,
								"risk",
								rules.filter((rule) => rule.kind === "risk"),
								shared,
							),
							...group(
								h,
								model,
								"opportunity",
								rules.filter((rule) => rule.kind === "opportunity"),
								shared,
							),
							h.p(
								[h.Class("text-muted-fg text-xs")],
								[
									"Each account gets at most one open item per rule. When the condition clears, the item resolves itself. Dismissed items only come back if the evidence gets worse.",
								],
							),
						]),
			]),
			pickerModal(h, model, shared),
		],
	)
}
