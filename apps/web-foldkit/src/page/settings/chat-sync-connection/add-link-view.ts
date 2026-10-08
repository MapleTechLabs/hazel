import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { IconHashtag } from "../../../icons"
import { button } from "../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader, dialogTitle } from "../../../ui/dialog"
import { description, label } from "../../../ui/field"
import * as Modal from "../../../ui/modal"
import type { DiscordChannel } from "../chat-sync/discord"
import {
	filterByName,
	scrollList,
	searchInput,
	selectedName,
	selectedRow,
	spinnerLine,
} from "../chat-sync/modal-parts"
import { CHANNEL_SEARCH_ID, type HazelChannel, Message, type Model, type SyncDirection } from "./model"

/** Port of `components/chat-sync/add-channel-link-modal.tsx`. */

const toAddLinkModalMessage = (message: Modal.Message) => Message.GotAddLinkModalMessage({ message })
const toChannelSearchMessage = (value: string) => Message.ChangedChannelSearch({ value })
const toDiscordSearchMessage = (value: string) => Message.ChangedDiscordChannelSearch({ value })

const DIRECTION_OPTIONS: ReadonlyArray<{
	readonly value: SyncDirection
	readonly label: string
	readonly description: string
	readonly d: string
}> = [
	{
		value: "both",
		label: "Both directions",
		description: "Messages sync both ways",
		d: "M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
	},
	{
		value: "hazel_to_external",
		label: "Hazel to Discord",
		description: "Only send messages to Discord",
		d: "M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3",
	},
	{
		value: "external_to_hazel",
		label: "Discord to Hazel",
		description: "Only receive messages from Discord",
		d: "M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18",
	},
]

const hashtag = (h: HtmlBuilder<Message>, className: string): Html => IconHashtag(h, { className })

const channelRow = (h: HtmlBuilder<Message>, key: string, name: string, onClick: Message): Html =>
	h.keyed("button")(
		key,
		[
			h.Type("button"),
			h.OnClick(onClick),
			h.Class(
				"flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/50",
			),
		],
		[hashtag(h, "size-4 shrink-0 text-muted-fg"), h.span([h.Class("truncate text-fg")], [name])],
	)

const pickedRow = (h: HtmlBuilder<Message>, name: string, onChange: Message): Html =>
	selectedRow(h, [hashtag(h, "size-4 text-muted-fg"), selectedName(h, name)], onChange)

const hazelSection = (h: HtmlBuilder<Message>, model: Model): Html =>
	h.div(
		[h.Class("flex flex-col gap-2")],
		[
			label(h, {}, ["Hazel Channel"]),
			model.selectedChannel === null
				? h.div(
						[h.Class("flex flex-col gap-2")],
						[
							searchInput(h, {
								id: CHANNEL_SEARCH_ID,
								placeholder: "Search channels...",
								value: model.channelSearch,
								isFocused: model.focusedSearch === "hazel",
								onInput: toChannelSearchMessage,
								onFocus: Message.FocusedSearch({ search: "hazel" }),
								onBlur: Message.BlurredSearch(),
							}),
							scrollList(
								h,
								"max-h-48",
								"No channels found",
								filterByName(model.hazelChannels, model.channelSearch).map((channel: HazelChannel) =>
									channelRow(h, channel.id, channel.name, Message.ClickedHazelChannel({ channel })),
								),
							),
						],
					)
				: pickedRow(h, model.selectedChannel.name, Message.ClickedChangeHazelChannel()),
		],
	)

const discordPicker = (
	h: HtmlBuilder<Message>,
	model: Model,
	channels: ReadonlyArray<DiscordChannel>,
): ReadonlyArray<Html> => [
	model.selectedDiscordChannel === null
		? h.div(
				[h.Class("flex flex-col gap-2")],
				[
					searchInput(h, {
						placeholder: "Search Discord channels...",
						value: model.discordChannelSearch,
						isFocused: model.focusedSearch === "discord",
						onInput: toDiscordSearchMessage,
						onFocus: Message.FocusedSearch({ search: "discord" }),
						onBlur: Message.BlurredSearch(),
					}),
					scrollList(
						h,
						"max-h-48",
						"No Discord channels found",
						filterByName(channels, model.discordChannelSearch).map((channel) =>
							channelRow(h, channel.id, channel.name, Message.ClickedDiscordChannel({ channel })),
						),
					),
				],
			)
		: pickedRow(h, model.selectedDiscordChannel.name, Message.ClickedChangeDiscordChannel()),
	description(h, {}, ["Select the Discord channel from the connected server."]),
]

const discordSection = (h: HtmlBuilder<Message>, model: Model): Html => {
	const channels = model.discordChannels
	const content =
		channels._tag === "Loading"
			? [
					h.div(
						[h.Class("flex items-center justify-center rounded-lg border border-border p-6")],
						[spinnerLine(h, "Loading Discord channels...")],
					),
				]
			: channels._tag === "Failed"
				? [
						h.div(
							[h.Class("rounded-lg border border-border bg-bg-muted/20 p-4")],
							[
								h.p([h.Class("font-medium text-fg text-sm")], ["Could not load Discord channels"]),
								h.p(
									[h.Class("mt-1 text-muted-fg text-sm")],
									["Make sure the bot is installed in this server and has channel access."],
								),
							],
						),
					]
				: discordPicker(h, model, channels.items)
	return h.div([h.Class("flex flex-col gap-2")], [label(h, {}, ["Discord Channel"]), ...content])
}

const directionButton = (
	h: HtmlBuilder<Message>,
	option: (typeof DIRECTION_OPTIONS)[number],
	isSelected: boolean,
): Html =>
	h.keyed("button")(
		option.value,
		[
			h.Type("button"),
			h.OnClick(Message.ClickedDirection({ direction: option.value })),
			h.Class(
				`flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-all ${
					isSelected
						? "border-primary bg-primary/5 ring-1 ring-primary"
						: "border-border hover:border-border-hover hover:bg-secondary/30"
				}`,
			),
		],
		[
			h.div(
				[h.Class(isSelected ? "text-primary" : "text-muted-fg")],
				[
					h.svg(
						[
							h.Class("size-5"),
							h.Attribute("fill", "none"),
							h.Attribute("viewBox", "0 0 24 24"),
							h.Attribute("stroke", "currentColor"),
							h.Attribute("stroke-width", "2"),
						],
						[
							h.path([
								h.Attribute("stroke-linecap", "round"),
								h.Attribute("stroke-linejoin", "round"),
								h.Attribute("d", option.d),
							]),
						],
					),
				],
			),
			h.div(
				[h.Class("flex flex-col gap-0.5")],
				[
					h.span(
						[h.Class(`font-medium text-xs ${isSelected ? "text-primary" : "text-fg"}`)],
						[option.label],
					),
					h.span([h.Class("text-muted-fg text-xs")], [option.description]),
				],
			),
		],
	)

const directionSection = (h: HtmlBuilder<Message>, model: Model): Html =>
	h.div(
		[h.Class("flex flex-col gap-2")],
		[
			label(h, {}, ["Sync Direction"]),
			h.div(
				[h.Class("grid grid-cols-1 gap-2 sm:grid-cols-3")],
				DIRECTION_OPTIONS.map((option) => directionButton(h, option, model.direction === option.value)),
			),
		],
	)

const content = (
	h: HtmlBuilder<Message>,
	model: Model,
	closeAttributes: ReadonlyArray<ChildAttribute>,
): ReadonlyArray<Html> => {
	const isValid = model.selectedChannel !== null && model.selectedDiscordChannel !== null
	return [
		dialogHeader(h, {}, [dialogTitle(h, { id: Modal.titleId(model.addLinkModal.id) }, "Link Channel")]),
		dialogBody(
			h,
			[hazelSection(h, model), discordSection(h, model), directionSection(h, model)],
			"flex flex-col gap-6",
		),
		dialogFooter(h, [
			dialogClose(h, closeAttributes, ["Cancel"], "secondary"),
			button(
				h,
				{
					intent: "primary",
					onPress: Message.ClickedCreateLink(),
					isDisabled: !isValid || model.isCreatingLink || model.discordChannels._tag !== "Loaded",
					isPending: model.isCreatingLink,
				},
				[model.isCreatingLink ? "Linking..." : "Link Channel"],
			),
		]),
	]
}

/** `<Modal><ModalContent isOpen onOpenChange size="lg">`, rendered while open. */
export const addLinkModal = (h: HtmlBuilder<Message>, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.addLinkModal,
		toParentMessage: toAddLinkModalMessage,
		toContent: (closeAttributes) => content(h, model, closeAttributes),
		size: "lg",
	})
