import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { IconFolder } from "../../icons"
import { button } from "../../ui/button"
import { emptyState } from "../../ui/empty-state"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

const Model = Schema.Struct({})
type Model = typeof Model.Type

const Message = defineMessageUnion({ IgnoredGallery: {} })
type Message = typeof Message.Type

const view = (_model: Model, h: HtmlBuilder<Message>) => {
	const folder = (className: string) => IconFolder(h, { className })
	return galleryFrame(h, "Empty state", [
		gallerySection(h, "Full", [
			emptyState(h, {
				icon: folder,
				title: "No channels yet",
				description: "Create a channel to start talking with your team.",
				action: button(h, { size: "sm" }, ["Create channel"]),
			}),
		]),
		gallerySection(h, "Title only", [emptyState(h, { title: "Nothing here" })]),
		gallerySection(h, "Long description", [
			emptyState(h, {
				icon: folder,
				title: "No results match your filters",
				description:
					"Try removing some filters or searching with different keywords. Results include messages, files and channels from every workspace you belong to.",
				className: "py-8",
			}),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Empty state", {
	Model,
	init: () => ({ model: {} }),
	update: (model) => ({ model }),
	view,
})
