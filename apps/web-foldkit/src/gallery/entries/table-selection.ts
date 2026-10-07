import { Option, Schema } from "effect"
import { Subscription, Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Table from "../../ui/table"
import * as TableView from "../../ui/table-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

/** Port of `dev-gallery/entries/table-selection.tsx`: multiple selection with checkboxes. */

// MODEL

const Model = Schema.Struct({ invite: Table.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotInviteMessage: { message: Table.Message },
})
type Message = typeof Message.Type

const toInviteMessage = (message: Table.Message) => Message.GotInviteMessage({ message })

// UPDATE

const foldInvite = Update.foldChild({
	update: Table.update,
	read: (model: Model) => Option.some(model.invite),
	write: (_model: Model, invite: Table.Model): Model => ({ invite }),
	toParentMessage: toInviteMessage,
})

// VIEW

const members = [
	{ id: "ada", name: "Ada Lovelace", role: "Owner" },
	{ id: "grace", name: "Grace Hopper", role: "Admin" },
	{ id: "alan", name: "Alan Turing", role: "Member" },
	{ id: "katherine", name: "Katherine Johnson", role: "Guest" },
]

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Table selection", [
		gallerySection(h, "Checkbox selection", [
			h.submodel({
				slotId: "invite",
				model: model.invite,
				view: TableView.view,
				viewInputs: {
					label: "Invite members",
					className: "w-[32rem]",
					columns: [
						{ key: "name", content: "Name", isRowHeader: true },
						{ key: "role", content: "Role" },
					],
					rows: members.map((member) => ({
						key: member.id,
						cells: [member.name, member.role],
						isDisabled: member.id === "katherine",
					})),
				},
				toParentMessage: toInviteMessage,
			}),
		]),
	])

export const gallery = defineGallery<Model, Message>("Table selection", {
	Model,
	init: () => ({
		model: {
			invite: Table.init({ id: "table-invite", selectionMode: "multiple", selectedKeys: ["grace"] }),
		},
	}),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotInviteMessage: ({ message }) => foldInvite(model, message),
		}),
	subscriptions: Subscription.lift(Table.subscriptions)<Model, Message>({
		read: (model) => Option.some(model.invite),
		toParentMessage: toInviteMessage,
	}),
	view,
})
