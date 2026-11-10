import type * as Customers from "@hazel/domain/customers"
import type { Html } from "foldkit/html"
import { type ConfigField, providerOf } from "../../../../customers/providers"
import { segmented } from "../../../../customers/ui/filter-bar"
import { IconClose, IconPlus, IconTrash } from "../../../../icons"
import { button } from "../../../../ui/button"
import { input } from "../../../../ui/input"
import { switchControl } from "../../../../ui/switch"
import { type ConfigTarget, Message } from "./message"
import { configFlag, configText, isSettingsDirty, isSettingsValid, type Model, settingsOf } from "./model"
import { card, cardHeader, eyebrow, formField, type H } from "./parts"
import type { ConnectionRow } from "./queries"

/**
 * A source's provider settings (Wonder `one` for Maple): the descriptor's config fields for any
 * provider, plus Maple's activity events, metric mappings and lookback. Saved with
 * `customers.connection.update({ config })`.
 */

/** One descriptor field: a switch for a boolean, an input for text. Shared with the connect modal. */
export const configFieldView = (
	h: H,
	options: Readonly<{
		field: ConfigField<Customers.CustomerProvider>
		config: Customers.ConnectionConfig
		target: ConfigTarget
		isDisabled: boolean
	}>,
): Html => {
	const { field, config, target, isDisabled } = options
	const id = `customers-${target}-${field.key}`
	if (field._tag === "Toggle")
		return h.div(
			[h.Class("flex items-start justify-between gap-4")],
			[
				h.div(
					[h.Class("flex min-w-0 flex-col gap-0.5")],
					[
						h.label([h.For(id), h.Class("font-medium text-fg text-sm")], [field.label]),
						h.p([h.Class("text-muted-fg text-xs")], [field.description]),
					],
				),
				switchControl(
					h,
					{
						id,
						isSelected: configFlag(config, field.key),
						isDisabled,
						onChange: (isSelected) =>
							Message.ToggledConfigField({ target, key: field.key, isSelected }),
					},
					[],
				),
			],
		)
	return formField(h, {
		id,
		label: field.label,
		description: field.description,
		value: configText(config, field.key),
		placeholder: field.placeholder,
		isCode: field.isCode,
		isDisabled,
		onInput: (value) => Message.ChangedConfigText({ target, key: field.key, value }),
	})
}

const LOOKBACK = [
	{ key: "30", label: "30d" },
	{ key: "90", label: "90d" },
	{ key: "180", label: "180d" },
	{ key: "365", label: "1y" },
] as const
type LookbackKey = (typeof LOOKBACK)[number]["key"]
const toLookback = (key: LookbackKey) => Message.ClickedLookback({ days: Number(key) })
const lookbackKeyOf = (days: number): LookbackKey =>
	LOOKBACK.find((option) => option.key === String(days))?.key ?? "90"

type MapleConfig = Extract<Customers.ConnectionConfig, { _tag: "maple" }>

const block = (h: H, title: string, description: string, children: ReadonlyArray<Html>): Html =>
	h.div(
		[h.Class("flex flex-col gap-3 border-border border-t pt-4")],
		[
			h.div(
				[h.Class("flex flex-col gap-0.5")],
				[
					h.h3([h.Class("font-medium text-fg text-sm")], [title]),
					h.p([h.Class("text-muted-fg text-xs")], [description]),
				],
			),
			...children,
		],
	)

const activityEvents = (h: H, model: Model, config: MapleConfig, isDisabled: boolean): Html =>
	block(
		h,
		"Activity events",
		"A contact is active on a day they send one of these events. None: every event counts.",
		[
			config.activityEvents.length === 0
				? h.p([h.Class("text-muted-fg text-sm")], ["Every event counts as activity."])
				: h.ul(
						[h.AriaLabel("Activity events"), h.Class("flex flex-wrap gap-1.5")],
						config.activityEvents.map((event) =>
							h.li(
								[
									h.Class(
										"inline-flex items-center gap-1 rounded-md bg-secondary py-0.5 pr-0.5 pl-2 font-mono text-fg text-xs",
									),
								],
								[
									event,
									...(isDisabled
										? []
										: [
												h.button(
													[
														h.Type("button"),
														h.AriaLabel(`Remove ${event}`),
														h.Class(
															"rounded p-0.5 text-muted-fg hover:bg-bg hover:text-fg",
														),
														h.OnClick(Message.RemovedActivityEvent({ event })),
													],
													[IconClose(h, { className: "size-3" })],
												),
											]),
								],
							),
						),
					),
			...(isDisabled
				? []
				: [
						h.form(
							[h.Class("flex items-center gap-2"), h.OnSubmit(Message.AddedActivityEvent())],
							[
								input(h, {
									placeholder: "Event name, e.g. query_run",
									className: "font-mono text-sm",
									attributes: [
										h.AriaLabel("Add an activity event"),
										h.Value(model.activityEventInput),
										h.OnInput((value) => Message.ChangedActivityEventInput({ value })),
									],
								}),
								button(
									h,
									{
										intent: "outline",
										size: "sm",
										isDisabled: model.activityEventInput.trim() === "",
										attributes: [h.Type("submit")],
									},
									["Add"],
								),
							],
						),
					]),
		],
	)

const metricMappings = (h: H, config: MapleConfig, isDisabled: boolean): Html =>
	block(
		h,
		"Per-account metrics",
		"A daily count per account of each mapped event, under its metric key. Usable in charts, signals and health.",
		[
			...(config.metricMappings.length === 0
				? [h.p([h.Class("text-muted-fg text-sm")], ["No event is mapped to a metric yet."])]
				: [
						h.div(
							[h.Class("grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2")],
							[
								eyebrow(h, "Event"),
								eyebrow(h, "Metric key"),
								h.span([]),
								...config.metricMappings.flatMap((mapping, index) => [
									input(h, {
										placeholder: "dashboard_created",
										className: "font-mono text-sm",
										isDisabled,
										isInvalid: mapping.event.trim() === "",
										attributes: [
											h.AriaLabel(`Event of metric ${index + 1}`),
											h.Value(mapping.event),
											h.OnInput((value) =>
												Message.ChangedMetricMapping({
													index,
													field: "event",
													value,
												}),
											),
										],
									}),
									input(h, {
										placeholder: "dashboards_created",
										className: "font-mono text-sm",
										isDisabled,
										isInvalid: mapping.metricKey.trim() === "",
										attributes: [
											h.AriaLabel(`Metric key of metric ${index + 1}`),
											h.Value(mapping.metricKey),
											h.OnInput((value) =>
												Message.ChangedMetricMapping({
													index,
													field: "metricKey",
													value,
												}),
											),
										],
									}),
									isDisabled
										? h.span([])
										: button(
												h,
												{
													intent: "plain",
													size: "sq-sm",
													onPress: Message.RemovedMetricMapping({ index }),
													attributes: [h.AriaLabel(`Remove metric ${index + 1}`)],
												},
												[IconTrash(h, { attributes: { "data-slot": "icon" } })],
											),
								]),
							],
						),
					]),
			...(isDisabled
				? []
				: [
						button(
							h,
							{
								intent: "outline",
								size: "sm",
								className: "self-start",
								onPress: Message.AddedMetricMapping(),
							},
							[IconPlus(h, { attributes: { "data-slot": "icon" } }), "Add metric"],
						),
					]),
			h.p([h.Class("text-muted-fg text-xs")], ["Changing a key keeps history under the old key."]),
		],
	)

const lookback = (h: H, config: MapleConfig, isDisabled: boolean): Html =>
	block(h, "Lookback", "How much history a backfill imports.", [
		isDisabled
			? h.p([h.Class("text-fg text-sm")], [`${config.lookbackDays} days`])
			: segmented(h, {
					ariaLabel: "Lookback window",
					segments: LOOKBACK,
					selected: lookbackKeyOf(config.lookbackDays),
					onSelect: toLookback,
					className: "self-start",
				}),
	])

export const settingsCard = (h: H, model: Model, connection: ConnectionRow, isAdmin: boolean): Html => {
	const descriptor = providerOf(connection.provider)
	const config = settingsOf(model, connection)
	const isDirty = isSettingsDirty(model, connection)
	const isDisabled = !isAdmin || model.isSavingSettings
	return card(h, [
		cardHeader(h, "Provider settings", `How Hazel matches and reads ${descriptor.name} records.`),
		...(descriptor.configFields.length === 0
			? []
			: [
					h.div(
						[h.Class("flex flex-col gap-4")],
						descriptor.configFields.map((field) =>
							configFieldView(h, { field, config, target: "settings", isDisabled }),
						),
					),
				]),
		...(config._tag === "maple"
			? [
					activityEvents(h, model, config, isDisabled),
					metricMappings(h, config, isDisabled),
					lookback(h, config, isDisabled),
				]
			: []),
		...(isAdmin && isDirty
			? [
					h.div(
						[
							h.Class(
								"flex flex-wrap items-center justify-end gap-2 border-border border-t pt-4",
							),
						],
						[
							h.span(
								[h.Class("mr-auto text-muted-fg text-sm")],
								[
									isSettingsValid(config)
										? "Unsaved changes"
										: "Fill in or remove the empty metric rows",
								],
							),
							button(
								h,
								{
									intent: "plain",
									size: "sm",
									isDisabled: model.isSavingSettings,
									onPress: Message.PressedDiscardSettings(),
								},
								["Discard"],
							),
							button(
								h,
								{
									intent: "primary",
									size: "sm",
									isPending: model.isSavingSettings,
									isDisabled: !isSettingsValid(config),
									onPress: Message.PressedSaveSettings(),
								},
								["Save"],
							),
						],
					),
				]
			: []),
	])
}
