import { CustomersRange } from "@hazel/domain/customers"
import { Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { IconPlus } from "../../../../icons"
import { button } from "../../../../ui/button"
import {
	addFilterButton,
	filterBar,
	filterChip,
	rangePicker,
	searchBox,
	segmented,
	sortTrigger,
	viewTabs,
} from "../../../../customers/ui/filter-bar"
import { QUEUE_SHORTCUTS, shortcutBar } from "../../../../customers/ui/shortcuts"
import { defineLab } from "../../../define"
import { labPage, labSection } from "../../../frame"

// `/lab/customers/kit/controls`: Foundations › Filter Bar And Tabs, live.

const QueueTab = Schema.Literals(["open", "snoozed", "done"])
const SavedView = Schema.Literals(["all", "mine", "paying", "trialing", "at_risk", "churned"])
const Grouping = Schema.Literals(["signals", "accounts"])
const CHIPS = [
	{ key: "kind", field: "Kind", operator: "is", value: "Risk" },
	{ key: "owner", field: "Owner", operator: "is", value: "Mine" },
	{ key: "severity", field: "Severity", operator: "is any of", value: "High, Medium" },
] as const

const Model = Schema.Struct({
	tab: QueueTab,
	view: SavedView,
	range: CustomersRange,
	grouping: Grouping,
	search: Schema.String,
	chips: Schema.Array(Schema.String),
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	ChoseTab: { tab: QueueTab },
	ChoseView: { view: SavedView },
	ChoseRange: { range: CustomersRange },
	ChoseGrouping: { grouping: Grouping },
	ChangedSearch: { value: Schema.String },
	RemovedChip: { key: Schema.String },
	ResetChips: {},
})
type Message = typeof Message.Type

const update = (model: Model, message: Message): { model: Model } => ({
	model: Message.match(message, {
		ChoseTab: ({ tab }) => ({ ...model, tab }),
		ChoseView: ({ view }) => ({ ...model, view }),
		ChoseRange: ({ range }) => ({ ...model, range }),
		ChoseGrouping: ({ grouping }) => ({ ...model, grouping }),
		ChangedSearch: ({ value }) => ({ ...model, search: value }),
		RemovedChip: ({ key }) => ({ ...model, chips: model.chips.filter((chip) => chip !== key) }),
		ResetChips: () => ({ ...model, chips: CHIPS.map((chip) => chip.key) }),
	}),
})

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
	labPage(h, { title: "Controls" }, [
		labSection(h, "View tabs · range picker", [
			h.div(
				[h.Class("flex flex-wrap items-end justify-between gap-4")],
				[
					viewTabs(h, {
						ariaLabel: "Queue",
						tabs: [
							{ key: "open", label: "Open", count: 12 },
							{ key: "snoozed", label: "Snoozed", count: 4 },
							{ key: "done", label: "Done" },
						],
						selected: model.tab,
						onSelect: (tab) => Message.ChoseTab({ tab }),
						className: "flex-1",
					}),
					rangePicker(h, {
						selected: model.range,
						onSelect: (range) => Message.ChoseRange({ range }),
					}),
				],
			),
		]),
		labSection(h, "Search · filter chips · sort · grouping", [
			filterBar(h, {
				start: [
					searchBox(h, {
						id: "lab-search",
						value: model.search,
						placeholder: "Search customers…",
						onInput: (value) => Message.ChangedSearch({ value }),
						onClear: Message.ChangedSearch({ value: "" }),
					}),
					...CHIPS.filter((chip) => model.chips.includes(chip.key)).map((chip) =>
						filterChip(h, {
							field: chip.field,
							operator: chip.operator,
							value: chip.value,
							onRemove: Message.RemovedChip({ key: chip.key }),
						}),
					),
					addFilterButton(h, { onPress: Message.ResetChips() }),
				],
				end: [
					sortTrigger(h, { label: "Priority" }),
					segmented(h, {
						ariaLabel: "Group by",
						segments: [
							{ key: "signals", label: "Signals" },
							{ key: "accounts", label: "Accounts" },
						],
						selected: model.grouping,
						onSelect: (grouping) => Message.ChoseGrouping({ grouping }),
					}),
				],
			}),
			h.p(
				[h.Class("text-muted-fg text-xs")],
				["+ Filter restores the removed chips here; on the page it opens the filter builder."],
			),
		]),
		labSection(h, "Saved views", [
			viewTabs(h, {
				ariaLabel: "Saved views",
				tabs: [
					{ key: "all", label: "All customers" },
					{ key: "mine", label: "My customers" },
					{ key: "paying", label: "Paying" },
					{ key: "trialing", label: "Trialing" },
					{ key: "at_risk", label: "At risk" },
					{ key: "churned", label: "Churned" },
				],
				selected: model.view,
				onSelect: (view) => Message.ChoseView({ view }),
				trailing: button(
					h,
					{ intent: "plain", size: "sq-xs", attributes: [h.AriaLabel("New view")] },
					[IconPlus(h)],
				),
			}),
		]),
		labSection(h, "Shortcut hints", [shortcutBar(h, QUEUE_SHORTCUTS)]),
	])

export const lab = defineLab("Controls", {
	Model,
	init: () => ({
		model: {
			tab: "open" as const,
			view: "all" as const,
			range: "30d" as const,
			grouping: "signals" as const,
			search: "",
			chips: CHIPS.map((chip) => chip.key),
		},
	}),
	update,
	view,
})
