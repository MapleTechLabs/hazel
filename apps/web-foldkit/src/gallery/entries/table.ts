import { Array, Option, Order, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Table from "../../ui/table"
import * as TableView from "../../ui/table-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Slot = Schema.Literals(["members", "sortable", "grid", "striped", "empty"])
type Slot = typeof Slot.Type

const Model = Schema.Struct({
	members: Table.Model,
	sortable: Table.Model,
	grid: Table.Model,
	striped: Table.Model,
	empty: Table.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotTableMessage: { slotId: Slot, message: Table.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldTable = (slot: Slot) =>
	Update.foldChild({
		update: Table.update,
		read: (model: Model) => Option.some(model[slot]),
		write: (model, nextTable) => ({ ...model, [slot]: nextTable }),
		toParentMessage: (message) => Message.GotTableMessage({ slotId: slot, message }),
	})

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotTableMessage: ({ slotId: slot, message }) => foldTable(slot)(model, message),
	})

// VIEW

interface Member {
	readonly id: string
	readonly name: string
	readonly role: string
	readonly channels: number
}

const members: ReadonlyArray<Member> = [
	{ id: "ada", name: "Ada Lovelace", role: "Owner", channels: 12 },
	{ id: "grace", name: "Grace Hopper", role: "Admin", channels: 7 },
	{ id: "alan", name: "Alan Turing", role: "Member", channels: 3 },
	{
		id: "katherine",
		name: "Katherine Johnson with a much longer display name",
		role: "Guest",
		channels: 1,
	},
]

const columns = (allowsSorting: boolean): ReadonlyArray<TableView.TableColumn> => [
	{ key: "name", content: "Name", isRowHeader: true, allowsSorting },
	{ key: "role", content: "Role" },
	{ key: "channels", content: "Channels", allowsSorting },
]

const toRows = (rows: ReadonlyArray<Member>, disabledKeys: ReadonlyArray<string> = []) =>
	rows.map((member) => ({
		key: member.id,
		cells: [member.name, member.role, String(member.channels)],
		isDisabled: disabledKeys.includes(member.id),
	}))

const sorted = (sort: Option.Option<Table.SortDescriptor>) =>
	Option.match(sort, {
		onNone: () => members,
		onSome: ({ column, direction }) => {
			const byColumn: Order.Order<Member> =
				column === "channels"
					? Order.mapInput(Order.Number, (member: Member) => member.channels)
					: Order.mapInput(Order.String, (member: Member) => member.name)
			return Array.sort(members, direction === "ascending" ? byColumn : Order.flip(byColumn))
		},
	})

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const table = (slot: Slot, viewInputs: TableView.ViewInputs) =>
		h.submodel({
			slotId: slot,
			model: model[slot],
			view: TableView.view,
			viewInputs,
			toParentMessage: (message) => Message.GotTableMessage({ slotId: slot, message }),
		})
	return galleryFrame(h, "Table", [
		gallerySection(h, "Selectable", [
			table("members", {
				label: "Members",
				className: "w-[40rem]",
				columns: columns(false),
				rows: toRows(members, ["alan"]),
			}),
		]),
		gallerySection(h, "Sortable", [
			table("sortable", {
				label: "Sortable members",
				columns: columns(true),
				rows: toRows(sorted(Table.sortOf(model.sortable))),
			}),
		]),
		gallerySection(h, "Grid and striped", [
			table("grid", {
				label: "Grid members",
				grid: true,
				columns: columns(false),
				rows: toRows(members.slice(0, 2)),
			}),
			table("striped", {
				label: "Striped members",
				striped: true,
				columns: columns(false),
				rows: toRows(members.slice(0, 3)),
			}),
		]),
		gallerySection(h, "Empty", [
			table("empty", {
				label: "No members",
				className: "w-[30rem]",
				columns: columns(false),
				rows: [],
				emptyState: [h.p([h.Class("py-6 text-center")], ["No members yet"])],
			}),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Table", {
	Model,
	init: () => ({
		model: {
			members: Table.init({ id: "table-members", selectionMode: "single", selectedKeys: ["grace"] }),
			sortable: Table.init({ id: "table-sortable", sort: { column: "name", direction: "ascending" } }),
			grid: Table.init({ id: "table-grid" }),
			striped: Table.init({ id: "table-striped" }),
			empty: Table.init({ id: "table-empty" }),
		},
	}),
	update,
	view,
})
