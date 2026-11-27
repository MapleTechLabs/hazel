import {
	type ConfigField,
	defaultConfigOf,
	type IntegrationConfig,
	type KeyValueListField,
	type NumberField,
	type SettingsField,
	type StringListField,
} from "@hazel/customer-integrations"
import { Option } from "effect"
import type { Html } from "foldkit/html"
import { providerOf } from "../../../../customers/providers"
import { segmented } from "../../../../ui/segmented-control"
import { IconClose, IconPlus, IconTrash } from "../../../../icons"
import { badge } from "../../../../ui/badge"
import { button, iconButton } from "../../../../ui/button"
import { label } from "../../../../ui/field"
import { input } from "../../../../ui/input"
import { switchControl } from "../../../../ui/switch"
import { Message } from "./message"
import {
	cellOf,
	configFlag,
	configList,
	configNumber,
	configRows,
	configText,
	isSettingsDirty,
	isSettingsValid,
	type Model,
	settingsFieldsOf,
	settingsOf,
	settingsProblemOf,
} from "./model"
import { eyebrow, formField, type H } from "./parts"
import { panel, panelHeader } from "../../../../ui/card"
import type { ConnectionRow, UnitMetricRow } from "./queries"
import { heading } from "../../../../ui/heading"

/**
 * A source's provider settings: the config fields of its presentation, then its `settings` fields
 * (string lists, key-value lists, numbers), in the order declared. Saved with `customers.connection.update({ config })`.
 * A metered source's units are saved one by one (`customers.metric.setUnit`).
 */

/** One descriptor field: a switch for a boolean, an input for text. Shared with the connect modal. */
export const configFieldView = (
	h: H,
	options: Readonly<{
		field: ConfigField
		config: IntegrationConfig
		isDisabled: boolean
	}>,
): Html => {
	const { field, config, isDisabled } = options
	const id = `customers-settings-${field.key}`
	if (field._tag === "Toggle")
		return h.div(
			[h.Class("flex items-start justify-between gap-4")],
			[
				h.div(
					[h.Class("flex min-w-0 flex-col gap-0.5")],
					[
						label(h, { htmlFor: id, className: "font-medium sm:text-sm" }, [field.label]),
						h.p([h.Class("text-muted-fg text-xs")], [field.description]),
					],
				),
				switchControl(
					h,
					{
						id,
						isSelected: configFlag(config, field.key),
						isDisabled,
						onChange: (isSelected) => Message.ToggledConfigField({ key: field.key, isSelected }),
					},
					[],
				),
			],
		)
	if (field._tag === "Select")
		return h.div(
			[h.Class("flex items-start justify-between gap-4")],
			[
				h.div(
					[h.Class("flex min-w-0 flex-col gap-0.5")],
					[
						h.span([h.Class("font-medium text-fg text-sm")], [field.label]),
						h.p([h.Class("text-muted-fg text-xs")], [field.description]),
					],
				),
				segmented(h, {
					ariaLabel: field.label,
					segments: field.options.map((option) => ({ key: option.value, label: option.label })),
					selected: configText(config, field.key),
					onSelect: (value: string) => Message.ChangedConfigText({ key: field.key, value }),
					className: isDisabled ? "pointer-events-none opacity-60" : undefined,
				}),
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
		onInput: (value) => Message.ChangedConfigText({ key: field.key, value }),
	})
}

const block = (h: H, title: string, description: string, children: ReadonlyArray<Html>): Html =>
	h.div(
		[h.Class("flex flex-col gap-3 border-border border-t pt-4")],
		[
			h.div(
				[h.Class("flex flex-col gap-0.5")],
				[
					heading(h, { variant: "subsection" }, [title]),
					h.p([h.Class("text-muted-fg text-xs")], [description]),
				],
			),
			...children,
		],
	)

const stringList = (
	h: H,
	model: Model,
	config: IntegrationConfig,
	field: StringListField,
	isDisabled: boolean,
): Html => {
	const values = configList(config, field.key)
	const typed = (model.settingsListInputs[field.key] ?? "").trim()
	return block(h, field.title, field.description, [
		values.length === 0
			? h.p([h.Class("text-muted-fg text-sm")], [field.emptyText])
			: h.ul(
					[h.AriaLabel(field.title), h.Class("flex flex-wrap gap-1.5")],
					values.map((item) =>
						h.li(
							[],
							[
								badge(
									h,
									{
										intent: "secondary",
										className: "max-w-full gap-1 pe-1 font-mono font-normal",
									},
									[
										h.span([h.Class("truncate")], [item]),
										...(isDisabled
											? []
											: [
													iconButton(
														h,
														{
															size: "sq-xs",
															className: "size-5 sm:size-5",
															label: `Remove ${item}`,
															onPress: Message.RemovedSettingsListItem({
																key: field.key,
																item,
															}),
														},
														IconClose(h, { attributes: { "data-slot": "icon" } }),
													),
												]),
									],
								),
							],
						),
					),
				),
		...(isDisabled
			? []
			: [
					h.form(
						[
							h.Class("flex items-center gap-2"),
							h.OnSubmit(Message.AddedSettingsListItem({ key: field.key })),
						],
						[
							input(h, {
								placeholder: field.placeholder,
								className: "font-mono text-sm",
								attributes: [
									h.AriaLabel(field.addLabel),
									h.Value(model.settingsListInputs[field.key] ?? ""),
									h.OnInput((value) =>
										Message.ChangedSettingsListInput({ key: field.key, value }),
									),
								],
							}),
							button(
								h,
								{
									intent: "outline",
									size: "sm",
									isDisabled: typed === "",
									attributes: [h.Type("submit")],
								},
								["Add"],
							),
						],
					),
					...(typed === ""
						? []
						: [
								h.p(
									[h.Class("text-warning-subtle-fg text-xs")],
									[`Press Add to include “${typed}”: saving leaves it out.`],
								),
							]),
				]),
	])
}

const keyValueList = (
	h: H,
	config: IntegrationConfig,
	field: KeyValueListField,
	isDisabled: boolean,
): Html => {
	const rows = configRows(config, field.key)
	return block(h, field.title, field.description, [
		...(rows.length === 0
			? [h.p([h.Class("text-muted-fg text-sm")], [field.emptyText])]
			: [
					h.div(
						[h.Class("grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2")],
						[
							...field.columns.map((column) => eyebrow(h, column.label)),
							h.span([]),
							...rows.flatMap((row, index) => [
								...field.columns.map((column) =>
									input(h, {
										placeholder: column.placeholder,
										className: "font-mono text-sm",
										isDisabled,
										isInvalid: cellOf(row, column.key).trim() === "",
										attributes: [
											h.AriaLabel(`${column.label} of ${field.itemNoun} ${index + 1}`),
											h.Value(cellOf(row, column.key)),
											h.OnInput((value) =>
												Message.ChangedSettingsCell({
													key: field.key,
													index,
													column: column.key,
													value,
												}),
											),
										],
									}),
								),
								isDisabled
									? h.span([])
									: button(
											h,
											{
												intent: "plain",
												size: "sq-sm",
												onPress: Message.RemovedSettingsRow({
													key: field.key,
													index,
												}),
												attributes: [
													h.AriaLabel(`Remove ${field.itemNoun} ${index + 1}`),
												],
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
							onPress: Message.AddedSettingsRow({ key: field.key }),
						},
						[IconPlus(h, { attributes: { "data-slot": "icon" } }), `Add ${field.itemNoun}`],
					),
				]),
		h.p([h.Class("text-muted-fg text-xs")], [field.note]),
	])
}

const numberChoice = (h: H, config: IntegrationConfig, field: NumberField, isDisabled: boolean): Html => {
	const value = configNumber(config, field.key)
	const shown = field.options.some((option) => option.value === value)
		? value
		: configNumber(defaultConfigOf(config._tag), field.key)
	return block(h, field.title, field.description, [
		isDisabled
			? h.p([h.Class("text-fg text-sm")], [`${value} ${field.unit}`])
			: segmented(h, {
					ariaLabel: field.ariaLabel,
					segments: field.options.map((option) => ({
						key: String(option.value),
						label: option.label,
					})),
					selected: String(shown),
					onSelect: (key: string) =>
						Message.ClickedSettingsNumber({ key: field.key, value: Number(key) }),
					className: "self-start",
				}),
	])
}

const settingsFieldView = (
	h: H,
	model: Model,
	config: IntegrationConfig,
	field: SettingsField,
	isDisabled: boolean,
): Html =>
	"columns" in field
		? keyValueList(h, config, field, isDisabled)
		: "options" in field
			? numberChoice(h, config, field, isDisabled)
			: stringList(h, model, config, field, isDisabled)

const unitRow = (h: H, model: Model, metric: UnitMetricRow, isDisabled: boolean): ReadonlyArray<Html> => {
	const toSubmit = Message.SubmittedUnit({ metricKey: metric.key })
	return [
		h.div(
			[h.Class("flex min-w-0 flex-col")],
			[
				h.span([h.Class("truncate text-fg text-sm")], [metric.name]),
				(metric.customUnit ?? metric.unit) === null
					? h.span([h.Class("text-warning-subtle-fg text-xs")], ["No unit yet"])
					: h.code([h.Class("truncate font-mono text-muted-fg text-xs")], [metric.key]),
			],
		),
		input(h, {
			placeholder: metric.unit ?? "GB, requests, credits",
			className: "text-sm",
			isDisabled,
			attributes: [
				h.AriaLabel(`Unit of ${metric.name}`),
				h.Attribute("maxlength", "40"),
				h.Value(model.unitDrafts[metric.key] ?? metric.customUnit ?? ""),
				h.OnInput((value) => Message.ChangedUnit({ metricKey: metric.key, value })),
				h.OnBlur(toSubmit),
				h.OnKeyDownPreventDefault((key) => (key === "Enter" ? Option.some(toSubmit) : Option.none())),
			],
		}),
	]
}

/** What one unit of each metered feature is: sources rarely say, and "8 traces" means nothing. */
export const unitsCard = (h: H, model: Model, connection: ConnectionRow, isAdmin: boolean): Html => {
	const name = providerOf(connection.provider).name
	const metrics = (model.unitMetrics ?? []).filter((metric) => metric.provider === connection.provider)
	return panel(h, {}, [
		panelHeader(h, {
			title: "Usage units",
			description: `What one unit of each metered feature is, e.g. GB or requests. Charts show values in it. Blank uses ${name}'s own, when it has one.`,
		}),
		metrics.length === 0
			? h.p(
					[h.Class("text-muted-fg text-sm")],
					[
						model.unitMetrics === null
							? "Loading…"
							: "No metered features yet. They show here after the next sync.",
					],
				)
			: h.div(
					[h.Class("grid grid-cols-[minmax(0,1fr)_minmax(0,14rem)] items-center gap-x-4 gap-y-3")],
					[
						eyebrow(h, "Feature"),
						eyebrow(h, "Unit"),
						...metrics.flatMap((metric) => unitRow(h, model, metric, !isAdmin)),
					],
				),
	])
}

export const settingsCard = (h: H, model: Model, connection: ConnectionRow, isAdmin: boolean): Html => {
	const descriptor = providerOf(connection.provider)
	const config = settingsOf(model, connection)
	const isDirty = isSettingsDirty(model, connection)
	const isDisabled = !isAdmin || model.isSavingSettings
	return panel(h, {}, [
		panelHeader(h, {
			title: "Provider settings",
			description: `How Hazel matches and reads ${descriptor.name} records.`,
		}),
		...(descriptor.configFields.length === 0
			? []
			: [
					h.div(
						[h.Class("flex flex-col gap-4")],
						descriptor.configFields.map((field) =>
							configFieldView(h, { field, config, isDisabled }),
						),
					),
				]),
		...settingsFieldsOf(config).map((field) => settingsFieldView(h, model, config, field, isDisabled)),
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
								[settingsProblemOf(config) ?? "Unsaved changes"],
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
