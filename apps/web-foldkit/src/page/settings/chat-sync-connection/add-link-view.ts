import * as AsyncData from "foldkit/asyncData"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { IconHashtag } from "../../../icons"
import { button } from "../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader, dialogTitle } from "../../../ui/dialog"
import { description, label } from "../../../ui/field"
import * as Modal from "../../../ui/modal"
import {
	type ChatSyncProvider,
	type ExternalChannel,
	isRetryable,
	PROVIDERS,
	type ResourceFailure,
	resourceFailureMessage,
} from "../chat-sync/providers"
import {
	filterByName,
	scrollList,
	searchInput,
	selectedName,
	selectedRow,
	spinnerLine,
} from "../chat-sync/modal-parts"
import {
	CHANNEL_SEARCH_ID,
	directionLabel,
	type HazelChannel,
	Message,
	type Model,
	type SyncDirection,
} from "./model"
import { CREATE_LINK_TARGET, interaction } from "./update"

/** Port of `components/chat-sync/add-channel-link-modal.tsx`. */

const toAddLinkModalMessage = (message: Modal.Message) => Message.GotAddLinkModalMessage({ message })
const toChannelSearchMessage = (value: string) => Message.ChangedChannelSearch({ value })
const toExternalSearchMessage = (value: string) => Message.ChangedExternalChannelSearch({ value })

interface DirectionOption {
	readonly value: SyncDirection
	readonly label: string
	readonly description: string
	readonly d: string
}

const directionOptions = (provider: ChatSyncProvider): ReadonlyArray<DirectionOption> => {
	const { name } = PROVIDERS[provider]
	return [
		{
			value: "both",
			label: "Both directions",
			description: "Messages sync both ways",
			d: "M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
		},
		{
			value: "hazel_to_external",
			label: directionLabel("hazel_to_external", provider),
			description: `Only send messages to ${name}`,
			d: "M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3",
		},
		{
			value: "external_to_hazel",
			label: directionLabel("external_to_hazel", provider),
			description: `Only receive messages from ${name}`,
			d: "M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18",
		},
	]
}

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
								filterByName(model.hazelChannels, model.channelSearch).map(
									(channel: HazelChannel) =>
										channelRow(
											h,
											channel.id,
											channel.name,
											Message.ClickedHazelChannel({ channel }),
										),
								),
							),
						],
					)
				: pickedRow(h, model.selectedChannel.name, Message.ClickedChangeHazelChannel()),
		],
	)

const externalPicker = (
	h: HtmlBuilder<Message>,
	model: Model,
	provider: ChatSyncProvider,
	channels: ReadonlyArray<ExternalChannel>,
): ReadonlyArray<Html> => {
	const { name, workspaceKind, copy } = PROVIDERS[provider]
	return [
		model.selectedExternalChannel === null
			? h.div(
					[h.Class("flex flex-col gap-2")],
					[
						searchInput(h, {
							placeholder: `Search ${name} channels...`,
							value: model.externalChannelSearch,
							isFocused: model.focusedSearch === "external",
							onInput: toExternalSearchMessage,
							onFocus: Message.FocusedSearch({ search: "external" }),
							onBlur: Message.BlurredSearch(),
						}),
						scrollList(
							h,
							"max-h-48",
							`No ${name} channels found`,
							filterByName(channels, model.externalChannelSearch).map((channel) =>
								channelRow(
									h,
									channel.id,
									channel.name,
									Message.ClickedExternalChannel({ channel }),
								),
							),
						),
					],
				)
			: pickedRow(h, model.selectedExternalChannel.name, Message.ClickedChangeExternalChannel()),
		description(h, {}, [
			`Select the ${name} channel from the connected ${workspaceKind}.`,
			...(copy.channelNote === null ? [] : [` ${copy.channelNote}`]),
		]),
	]
}

const loadingChannels = (h: HtmlBuilder<Message>, provider: ChatSyncProvider): ReadonlyArray<Html> => [
	h.div(
		[h.Class("flex items-center justify-center rounded-lg border border-border p-6")],
		[spinnerLine(h, `Loading ${PROVIDERS[provider].name} channels...`)],
	),
]

/** Why the channels didn't load, with "Try again" when the reason is transient. */
const loadFailed = (
	h: HtmlBuilder<Message>,
	provider: ChatSyncProvider,
	reason: ResourceFailure,
): ReadonlyArray<Html> => {
	const message = resourceFailureMessage(provider, reason, "channels")
	return [
		h.div(
			[h.Class("rounded-lg border border-border bg-bg-muted/20 p-4")],
			[
				h.p([h.Class("font-medium text-fg text-sm")], [message.title]),
				...(message.description === undefined
					? []
					: [h.p([h.Class("mt-1 text-muted-fg text-sm")], [message.description])]),
				...(isRetryable(reason)
					? [
							button(
								h,
								{
									intent: "secondary",
									size: "sm",
									className: "mt-3",
									onPress: Message.ClickedRetryListExternalChannels(),
								},
								["Try again"],
							),
						]
					: []),
			],
		),
	]
}

const externalSection = (h: HtmlBuilder<Message>, model: Model, provider: ChatSyncProvider): Html => {
	const content = AsyncData.match(model.externalChannels, {
		onIdle: () => loadingChannels(h, provider),
		onLoading: () => loadingChannels(h, provider),
		onFailure: (reason) => loadFailed(h, provider, reason),
		onRefreshing: (channels) => externalPicker(h, model, provider, channels),
		onStale: ({ data }) => externalPicker(h, model, provider, data),
		onSuccess: (channels) => externalPicker(h, model, provider, channels),
	})
	return h.div(
		[h.Class("flex flex-col gap-2")],
		[label(h, {}, [`${PROVIDERS[provider].name} Channel`]), ...content],
	)
}

const directionButton = (h: HtmlBuilder<Message>, option: DirectionOption, isSelected: boolean): Html =>
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

const directionSection = (h: HtmlBuilder<Message>, model: Model, provider: ChatSyncProvider): Html =>
	h.div(
		[h.Class("flex flex-col gap-2")],
		[
			label(h, {}, ["Sync Direction"]),
			h.div(
				[h.Class("grid grid-cols-1 gap-2 sm:grid-cols-3")],
				directionOptions(provider).map((option) =>
					directionButton(h, option, model.direction === option.value),
				),
			),
		],
	)

const content = (
	h: HtmlBuilder<Message>,
	model: Model,
	provider: ChatSyncProvider,
	closeAttributes: ReadonlyArray<ChildAttribute>,
): ReadonlyArray<Html> => {
	const isValid = model.selectedChannel !== null && model.selectedExternalChannel !== null
	const isSubmitting = model.submission._tag === "Submitting"
	return [
		dialogHeader(h, {}, [dialogTitle(h, { id: Modal.titleId(model.addLinkModal.id) }, "Link Channel")]),
		dialogBody(
			h,
			[
				hazelSection(h, model),
				externalSection(h, model, provider),
				directionSection(h, model, provider),
			],
			"flex flex-col gap-6",
		),
		dialogFooter(h, [
			dialogClose(h, closeAttributes, ["Cancel"], "secondary"),
			button(
				h,
				{
					intent: "primary",
					onPress: Message.ClickedCreateLink(),
					isDisabled: !isValid || isSubmitting || !AsyncData.isSuccess(model.externalChannels),
					isPending: isSubmitting,
					interaction: { wiring: interaction.wiring(model), target: CREATE_LINK_TARGET },
				},
				[isSubmitting ? "Linking..." : "Link Channel"],
			),
		]),
	]
}

/** `<Modal><ModalContent isOpen onOpenChange size="lg">`, rendered while open. */
export const addLinkModal = (h: HtmlBuilder<Message>, model: Model, provider: ChatSyncProvider): Html =>
	Modal.controlledModal(h, {
		model: model.addLinkModal,
		toParentMessage: toAddLinkModalMessage,
		toContent: (closeAttributes) => content(h, model, provider, closeAttributes),
		size: "lg",
	})
