import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { button } from "../../ui/button"
import { sectionFooterActions, sectionFooterRoot } from "../../ui/section-footer"
import {
	sectionHeaderActions,
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../ui/section-header"
import { sectionLabelActions, sectionLabelRoot } from "../../ui/section-label"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

const Model = Schema.Struct({})
type Model = typeof Model.Type

const Message = defineMessageUnion({ IgnoredGallery: {} })
type Message = typeof Message.Type

const view = (_model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Section header", [
		gallerySection(h, "Header", [
			h.div(
				[h.Class("w-[36rem]")],
				[
					sectionHeaderRoot(h, {}, [
						sectionHeaderGroup(h, {}, [
							h.div(
								[h.Class("flex flex-1 flex-col gap-1")],
								[
									sectionHeaderHeading(h, {}, ["Members"]),
									sectionHeaderSubheading(h, {}, [
										"Manage who has access to this workspace.",
									]),
								],
							),
							sectionHeaderActions(h, {}, [
								button(h, { intent: "outline", size: "sm" }, ["Export"]),
								button(h, { size: "sm" }, ["Invite"]),
							]),
						]),
					]),
				],
			),
			sectionHeaderHeading(h, { size: "xl" }, ["Extra large heading"]),
		]),
		gallerySection(h, "Label", [
			sectionLabelRoot(h, { title: "Display name", description: "Shown to everyone." }),
			sectionLabelRoot(
				h,
				{ title: "Email", size: "md", isRequired: true, description: "Used for sign in." },
				[sectionLabelActions(h, {}, [button(h, { size: "xs" }, ["Verify"])])],
			),
		]),
		gallerySection(h, "Footer", [
			h.div(
				[h.Class("flex w-[36rem] flex-col gap-6")],
				[
					sectionFooterRoot(h, {}, [
						h.span([h.Class("text-muted-fg text-sm")], ["Changes are saved per workspace."]),
						sectionFooterActions(h, {}, [
							button(h, { intent: "outline", size: "sm" }, ["Cancel"]),
							button(h, { size: "sm" }, ["Save"]),
						]),
					]),
					sectionFooterRoot(h, { isCard: true }, [
						sectionFooterActions(h, {}, [button(h, { size: "sm" }, ["Save card"])]),
					]),
				],
			),
		]),
	])

export const gallery = defineGallery<Model, Message>("Section header", {
	Model,
	init: () => ({ model: {} }),
	update: (model) => ({ model }),
	view,
})
