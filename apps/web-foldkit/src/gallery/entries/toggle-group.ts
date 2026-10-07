import { Option, Record, Schema } from "effect"
import { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { IconStar } from "../../icons"
import * as ToggleGroup from "../../ui/toggle-group"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Record(Schema.String, ToggleGroup.Model)
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotToggleGroupMessage: { label: Schema.String, message: ToggleGroup.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldToggleGroup = (label: string) =>
	Update.foldChild({
		update: ToggleGroup.update,
		read: (model: Model) => Record.get(model, label),
		write: (model, nextGroup) => ({ ...model, [label]: nextGroup }),
		toParentMessage: (message) => Message.GotToggleGroupMessage({ label, message }),
	})

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotToggleGroupMessage: ({ label, message }) => foldToggleGroup(label)(model, message),
	})

// VIEW

interface GroupSpec extends Omit<ToggleGroup.ViewInputs, "items"> {
	readonly label: string
	readonly selectionMode?: ToggleGroup.SelectionMode
	readonly selectedKeys?: ReadonlyArray<string>
	readonly items: (h: HtmlBuilder<Message>) => ReadonlyArray<ToggleGroup.ToggleGroupItem>
}

const labelled = (entries: ReadonlyArray<readonly [string, string]>, disabledKey?: string) => () =>
	entries.map(([key, label]) => ({ key, content: [label], isDisabled: key === disabledKey }))

const star = (h: HtmlBuilder<Message>): Html => IconStar(h)

const sections: ReadonlyArray<readonly [string, ReadonlyArray<GroupSpec>]> = [
	[
		"Single",
		[
			{
				label: "Alignment",
				selectedKeys: ["center"],
				items: labelled(
					[
						["left", "Left"],
						["center", "Center"],
						["right", "Right"],
						["justify", "Justify"],
					],
					"justify",
				),
			},
		],
	],
	[
		"Multiple",
		[
			{
				label: "Formatting",
				selectionMode: "multiple",
				selectedKeys: ["bold", "italic"],
				items: labelled([
					["bold", "Bold"],
					["italic", "Italic"],
					["underline", "Underline"],
				]),
			},
		],
	],
	[
		"Vertical",
		[
			{
				label: "Density",
				orientation: "vertical",
				selectedKeys: ["compact"],
				items: labelled([
					["compact", "Compact"],
					["comfortable", "Comfortable"],
					["spacious", "Spacious"],
				]),
			},
			{
				label: "Layers",
				orientation: "vertical",
				selectionMode: "multiple",
				selectedKeys: ["grid"],
				items: labelled([
					["grid", "Grid"],
					["guides", "Guides"],
					["rulers", "Rulers"],
				]),
			},
		],
	],
	[
		"Sizes and circle",
		[
			{
				label: "Small",
				size: "sm",
				selectedKeys: ["day"],
				items: labelled([
					["day", "Day"],
					["week", "Week"],
				]),
			},
			{
				label: "Large",
				size: "lg",
				isCircle: true,
				selectedKeys: ["month"],
				items: labelled([
					["month", "Month"],
					["year", "Year"],
				]),
			},
			{
				label: "Favorites",
				size: "sq-sm",
				selectionMode: "multiple",
				isCircle: true,
				items: (h) => [
					{ key: "star", ariaLabel: "Star", content: [star(h)] },
					{ key: "star-two", ariaLabel: "Star two", content: [star(h)] },
				],
			},
		],
	],
]

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(
		h,
		"Toggle group",
		sections.map(([title, groups]) =>
			gallerySection(
				h,
				title,
				groups.flatMap(({ label, selectionMode: _mode, selectedKeys: _keys, items, ...viewInputs }) =>
					Option.match(Record.get(model, label), {
						onNone: () => [],
						onSome: (group) => [
							h.submodel({
								slotId: label,
								model: group,
								view: ToggleGroup.view,
								viewInputs: { ...viewInputs, items: items(h) },
								toParentMessage: (message) =>
									Message.GotToggleGroupMessage({ label, message }),
							}),
						],
					}),
				),
			),
		),
	)

export const gallery = defineGallery<Model, Message>("Toggle group", {
	Model,
	init: () => ({
		model: Record.fromEntries(
			sections.flatMap(([, groups]) =>
				groups.map(
					({ label, selectionMode, selectedKeys }) =>
						[label, ToggleGroup.init({ label, selectionMode, selectedKeys })] as const,
				),
			),
		),
	}),
	update,
	view,
})
