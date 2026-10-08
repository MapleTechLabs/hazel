import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { IconFolder, IconHashtag } from "../../icons"
import * as Tree from "../../ui/tree"
import * as TreeView from "../../ui/tree-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({ channels: Tree.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotTreeMessage: { message: Tree.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldTree = Update.foldChild({
	update: Tree.update,
	read: (model: Model) => Option.some(model.channels),
	write: (model, nextTree) => modifyFields(model, { channels: () => nextTree }),
	toParentMessage: (message) => Message.GotTreeMessage({ message }),
})

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotTreeMessage: ({ message }) => foldTree(model, message),
	})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const folder = (label: string) => [IconFolder(h), label]
	const channel = (label: string) => [IconHashtag(h), label]
	const leaf = (key: string, isDisabled = false): TreeView.TreeNode => ({
		key,
		textValue: key,
		content: channel(key),
		isDisabled,
	})
	return galleryFrame(h, "Tree", [
		gallerySection(h, "Channels", [
			h.submodel({
				slotId: "channels",
				model: model.channels,
				view: TreeView.view,
				viewInputs: {
					label: "Channels",
					className: "w-72",
					nodes: [
						{
							key: "engineering",
							textValue: "Engineering",
							content: folder("Engineering"),
							children: [leaf("frontend"), leaf("backend"), leaf("archived", true)],
						},
						{
							key: "design",
							textValue: "Design",
							content: folder("Design"),
							children: [leaf("research")],
						},
						leaf("general"),
					],
				},
				toParentMessage: (message) => Message.GotTreeMessage({ message }),
			}),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Tree", {
	Model,
	init: () => ({ model: { channels: Tree.init({ id: "tree-channels", expandedKeys: ["engineering"] }) } }),
	update,
	view,
})
