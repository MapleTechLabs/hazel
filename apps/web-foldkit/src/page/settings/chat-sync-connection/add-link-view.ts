import * as AsyncData from "foldkit/asyncData"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { IconHashtag, IconMagnifier3, IconPlus } from "../../../icons"
import { button } from "../../../ui/button"
import {
	dialogBody,
	dialogClose,
	dialogDescription,
	dialogFooter,
	dialogHeader,
	dialogTitle,
} from "../../../ui/dialog"
import { description, label } from "../../../ui/field"
import { input, inputGroup } from "../../../ui/input"
import * as Modal from "../../../ui/modal"
import {
	type ChatSyncProvider,
	type ExternalChannel,
	isRetryable,
	PROVIDERS,
	type ResourceFailure,
	resourceFailureMessage,
} from "../chat-sync/providers"
import { filterByName, spinnerLine } from "../chat-sync/modal-parts"
import {
	CHANNEL_SEARCH_ID,
	directionLabel,
	EXTERNAL_SEARCH_ID,
	type HazelChannel,
	type HazelChannelMode,
	HistoryImport,
	isLinkReady,
	isSubmitting,
	listedLinks,
	Message,
	type Model,
	NEW_CHANNEL_NAME_ID,
	newChannelNameOf,
	type SyncDirection,
} from "./model"
import { CREATE_LINK_TARGET, interaction } from "./update"

/**
 * The Link Channel modal: pick the external channel, then the Hazel channel it mirrors (an existing
 * one, or a new one named after it), then which way messages flow.
 */

const toAddLinkModalMessage = (message: Modal.Message) => Message.GotAddLinkModalMessage({ message })
const toChannelSearchMessage = (value: string) => Message.ChangedChannelSearch({ value })
const toExternalSearchMessage = (value: string) => Message.ChangedExternalChannelSearch({ value })
const toNewChannelNameMessage = (value: string) => Message.ChangedNewChannelName({ value })

// --- Building blocks --------------------------------------------------------------------------

const hashtag = (h: HtmlBuilder<Message>, className = "size-4 shrink-0 text-muted-fg"): Html =>
	IconHashtag(h, { className })

const sectionLabel = (h: HtmlBuilder<Message>, text: string, trailing: ReadonlyArray<Html> = []): Html =>
	h.div([h.Class("flex min-h-7 items-center justify-between gap-3")], [label(h, {}, [text]), ...trailing])

interface Segment<K extends string> {
	readonly value: K
	readonly label: string
	readonly icon?: Html
}

/** A radio group drawn as a segmented control. */
const segmented = <K extends string>(
	h: HtmlBuilder<Message>,
	options: Readonly<{
		ariaLabel: string
		segments: ReadonlyArray<Segment<K>>
		selected: K
		onSelect: (value: K) => Message
		isDisabled?: boolean
		className?: string
	}>,
): Html =>
	h.div(
		[
			h.Role("radiogroup"),
			h.AriaLabel(options.ariaLabel),
			h.Class(`flex gap-0.5 rounded-lg bg-secondary/70 p-0.5 ${options.className ?? ""}`),
		],
		options.segments.map((segment) => {
			const isSelected = segment.value === options.selected
			return h.keyed("button")(
				segment.value,
				[
					h.Type("button"),
					h.Role("radio"),
					h.Attribute("aria-checked", isSelected ? "true" : "false"),
					...(options.isDisabled
						? [h.Disabled(true)]
						: [h.OnClick(options.onSelect(segment.value))]),
					h.Class(
						`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium text-xs transition-colors duration-150 outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 ${
							isSelected
								? "bg-bg text-fg shadow-xs ring-1 ring-border"
								: "text-muted-fg enabled:hover:text-fg"
						}`,
					),
				],
				[...(segment.icon ? [segment.icon] : []), h.span([h.Class("truncate")], [segment.label])],
			)
		}),
	)

const linkedBadge = (h: HtmlBuilder<Message>): Html =>
	h.span(
		[
			h.Class(
				"ml-auto shrink-0 rounded-md bg-secondary px-1.5 py-0.5 font-medium text-2xs text-muted-fg",
			),
		],
		["Linked"],
	)

const channelRow = (
	h: HtmlBuilder<Message>,
	options: Readonly<{ key: string; name: string; isLinked: boolean; onClick: Message }>,
): Html =>
	h.keyed("button")(
		options.key,
		[
			h.Type("button"),
			h.OnClick(options.onClick),
			h.Class(
				"group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-hidden transition-colors hover:bg-secondary focus-visible:bg-secondary",
			),
		],
		[
			hashtag(h, "size-4 shrink-0 text-muted-fg group-hover:text-fg"),
			h.span([h.Class("truncate text-fg")], [options.name]),
			...(options.isLinked ? [linkedBadge(h)] : []),
		],
	)

/** A search field and its result list in one bordered box, the way a combobox opens. */
const picker = (
	h: HtmlBuilder<Message>,
	options: Readonly<{
		id: string
		placeholder: string
		search: string
		onInput: (value: string) => Message
		onFocus: Message
		emptyText: string
		rows: ReadonlyArray<Html>
		/** A last row after the results, such as "Create #name". */
		footer: Html | null
	}>,
): Html =>
	h.div(
		[
			h.Class(
				"overflow-hidden rounded-lg border border-border bg-bg transition-[border-color,box-shadow] duration-150 focus-within:border-ring/70 focus-within:ring-3 focus-within:ring-ring/20",
			),
		],
		[
			h.label(
				[h.Class("flex items-center gap-2 border-border border-b px-3")],
				[
					IconMagnifier3(h, { className: "size-4 shrink-0 text-muted-fg" }),
					h.input([
						h.Id(options.id),
						h.Type("text"),
						h.Attribute("autocomplete", "off"),
						h.Attribute("spellcheck", "false"),
						h.Placeholder(options.placeholder),
						h.Value(options.search),
						h.OnInput(options.onInput),
						h.OnFocus(options.onFocus),
						h.OnBlur(Message.BlurredSearch()),
						h.Class(
							"h-10 w-full min-w-0 bg-transparent text-fg text-sm outline-hidden placeholder:text-muted-fg",
						),
					]),
				],
			),
			h.div(
				[h.Class("max-h-44 overflow-y-auto overscroll-contain p-1")],
				options.rows.length === 0 && options.footer === null
					? [h.div([h.Class("px-3 py-6 text-center text-muted-fg text-sm")], [options.emptyText])]
					: [...options.rows, ...(options.footer === null ? [] : [options.footer])],
			),
		],
	)

/** The chosen channel, with "Change" to pick again. */
const pickedRow = (h: HtmlBuilder<Message>, name: string, onChange: Message, isDisabled: boolean): Html =>
	h.div(
		[
			h.Class(
				"flex h-11 items-center gap-2.5 rounded-lg border border-border bg-secondary/30 pr-1.5 pl-3",
			),
		],
		[
			hashtag(h, "size-4 shrink-0 text-fg"),
			h.span([h.Class("min-w-0 flex-1 truncate font-medium text-fg text-sm")], [name]),
			button(
				h,
				{ intent: "plain", size: "sm", isDisabled, onPress: onChange, className: "text-muted-fg" },
				["Change"],
			),
		],
	)

/** The list's loading state, the same height as the list so the dialog doesn't jump. */
const loadingChannels = (h: HtmlBuilder<Message>, provider: ChatSyncProvider): Html =>
	h.div(
		[h.Class("flex h-[13.5rem] items-center justify-center rounded-lg border border-border")],
		[spinnerLine(h, `Loading ${PROVIDERS[provider].name} channels...`)],
	)

/** Why the channels didn't load, with "Try again" when the reason is transient. */
const loadFailed = (h: HtmlBuilder<Message>, provider: ChatSyncProvider, reason: ResourceFailure): Html => {
	const message = resourceFailureMessage(provider, reason, "channels")
	return h.div(
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
	)
}

// --- External channel ---------------------------------------------------------------------------

const externalPicker = (
	h: HtmlBuilder<Message>,
	model: Model,
	provider: ChatSyncProvider,
	channels: ReadonlyArray<ExternalChannel>,
): Html => {
	if (model.selectedExternalChannel !== null)
		return pickedRow(
			h,
			model.selectedExternalChannel.name,
			Message.ClickedChangeExternalChannel(),
			isSubmitting(model),
		)
	const { name } = PROVIDERS[provider]
	const linkedNames = new Set(listedLinks(model).map((link) => link.externalName))
	return picker(h, {
		id: EXTERNAL_SEARCH_ID,
		placeholder: `Search ${name} channels...`,
		search: model.externalChannelSearch,
		onInput: toExternalSearchMessage,
		onFocus: Message.FocusedSearch({ search: "external" }),
		emptyText: `No ${name} channels found`,
		rows: filterByName(channels, model.externalChannelSearch).map((channel) =>
			channelRow(h, {
				key: channel.id,
				name: channel.name,
				isLinked: linkedNames.has(channel.name),
				onClick: Message.ClickedExternalChannel({ channel }),
			}),
		),
		footer: null,
	})
}

const externalSection = (h: HtmlBuilder<Message>, model: Model, provider: ChatSyncProvider): Html => {
	const { name, copy } = PROVIDERS[provider]
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
		[
			sectionLabel(h, `${name} Channel`),
			content,
			...(copy.channelNote === null ? [] : [description(h, {}, [copy.channelNote])]),
		],
	)
}

// --- Hazel channel ------------------------------------------------------------------------------

const hazelModes: ReadonlyArray<Segment<HazelChannelMode>> = [
	{ value: "existing", label: "Existing" },
	{ value: "new", label: "New channel" },
]

const existingHazelPicker = (h: HtmlBuilder<Message>, model: Model): Html => {
	if (model.selectedChannel !== null)
		return pickedRow(
			h,
			model.selectedChannel.name,
			Message.ClickedChangeHazelChannel(),
			isSubmitting(model),
		)
	const linkedIds = new Set<string>(listedLinks(model).map((link) => link.hazelChannelId))
	const search = newChannelNameOf(model.channelSearch)
	const hasExactMatch = model.hazelChannels.some(
		(channel: HazelChannel) => channel.name.toLowerCase() === search.toLowerCase(),
	)
	return picker(h, {
		id: CHANNEL_SEARCH_ID,
		placeholder: "Search channels...",
		search: model.channelSearch,
		onInput: toChannelSearchMessage,
		onFocus: Message.FocusedSearch({ search: "hazel" }),
		emptyText: "No channels found",
		rows: filterByName(model.hazelChannels, model.channelSearch).map((channel: HazelChannel) =>
			channelRow(h, {
				key: channel.id,
				name: channel.name,
				isLinked: linkedIds.has(channel.id),
				onClick: Message.ClickedHazelChannel({ channel }),
			}),
		),
		footer:
			search.length === 0 || hasExactMatch
				? null
				: h.keyed("button")(
						"create-from-search",
						[
							h.Type("button"),
							h.OnClick(Message.ClickedCreateChannelFromSearch()),
							h.Class(
								"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-hidden transition-colors hover:bg-secondary focus-visible:bg-secondary",
							),
						],
						[
							IconPlus(h, { className: "size-4 shrink-0 text-primary" }),
							h.span([h.Class("text-muted-fg")], ["Create"]),
							h.span([h.Class("truncate font-medium text-fg")], [`#${search}`]),
						],
					),
	})
}

const newHazelChannel = (h: HtmlBuilder<Message>, model: Model, provider: ChatSyncProvider): Html => {
	const name = newChannelNameOf(model.newChannelName)
	const clash = model.hazelChannels.find((channel) => channel.name.toLowerCase() === name.toLowerCase())
	return h.div(
		[h.Class("flex flex-col gap-2")],
		[
			inputGroup(h, { role: "presentation" }, [
				hashtag(h),
				input(h, {
					placeholder: "channel-name",
					isDisabled: isSubmitting(model),
					attributes: [
						h.Id(NEW_CHANNEL_NAME_ID),
						h.AriaLabel("New channel name"),
						h.Attribute("autocomplete", "off"),
						h.Attribute("maxlength", "80"),
						h.Value(model.newChannelName),
						h.OnInput(toNewChannelNameMessage),
					],
				}),
			]),
			description(h, {}, [
				clash === undefined
					? name.length === 0
						? `Name the channel ${PROVIDERS[provider].name} messages arrive in.`
						: `Creates a public channel, #${name}, and links it.`
					: `#${clash.name} already exists. Choose it under Existing to link it instead.`,
			]),
		],
	)
}

const hazelSection = (h: HtmlBuilder<Message>, model: Model, provider: ChatSyncProvider): Html =>
	h.div(
		[h.Class("flex flex-col gap-2")],
		[
			sectionLabel(h, "Hazel Channel", [
				segmented(h, {
					ariaLabel: "Hazel channel",
					segments: hazelModes,
					selected: model.hazelChannelMode,
					onSelect: (mode) => Message.ClickedHazelChannelMode({ mode }),
					isDisabled: isSubmitting(model),
					className: "w-52",
				}),
			]),
			model.hazelChannelMode === "new"
				? newHazelChannel(h, model, provider)
				: existingHazelPicker(h, model),
		],
	)

// --- Direction ----------------------------------------------------------------------------------

const ARROWS = {
	both: "M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
	hazel_to_external: "M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3",
	external_to_hazel: "M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18",
} satisfies Record<SyncDirection, string>

const arrow = (h: HtmlBuilder<Message>, direction: SyncDirection): Html =>
	h.svg(
		[
			h.Class("size-3.5 shrink-0"),
			h.Attribute("aria-hidden", "true"),
			h.Attribute("fill", "none"),
			h.Attribute("viewBox", "0 0 24 24"),
			h.Attribute("stroke", "currentColor"),
			h.Attribute("stroke-width", "2"),
		],
		[
			h.path([
				h.Attribute("stroke-linecap", "round"),
				h.Attribute("stroke-linejoin", "round"),
				h.Attribute("d", ARROWS[direction]),
			]),
		],
	)

const directionSummary = (direction: SyncDirection, provider: ChatSyncProvider): string => {
	const { name } = PROVIDERS[provider]
	if (direction === "hazel_to_external")
		return `Hazel messages are posted to ${name}. ${name} messages stay in ${name}.`
	if (direction === "external_to_hazel")
		return `${name} messages are posted to Hazel. Hazel messages stay in Hazel.`
	return "Messages sync both ways."
}

const directionSection = (h: HtmlBuilder<Message>, model: Model, provider: ChatSyncProvider): Html =>
	h.div(
		[h.Class("flex flex-col gap-2")],
		[
			sectionLabel(h, "Sync Direction"),
			segmented(h, {
				ariaLabel: "Sync direction",
				segments: (["both", "hazel_to_external", "external_to_hazel"] as const).map((value) => ({
					value,
					label: value === "both" ? "Both directions" : directionLabel(value, provider),
					icon: arrow(h, value),
				})),
				selected: model.direction,
				onSelect: (direction) => Message.ClickedDirection({ direction }),
				isDisabled: isSubmitting(model),
			}),
			description(h, {}, [directionSummary(model.direction, provider)]),
		],
	)

// --- History ------------------------------------------------------------------------------------

const HISTORY_LABELS = { none: "None", "100": "Last 100", "500": "Last 500" } satisfies Record<
	HistoryImport,
	string
>

const historySummary = (history: HistoryImport, provider: ChatSyncProvider): string => {
	const { name } = PROVIDERS[provider]
	if (history === "none") return `Only messages sent from now on are synced.`
	return `The latest ${history} ${name} messages are copied in with their original times, without notifying anyone. Thread replies stay in ${name}.`
}

/** Shown only while the direction brings external messages into Hazel. */
const historySection = (h: HtmlBuilder<Message>, model: Model, provider: ChatSyncProvider): Html =>
	h.div(
		[h.Class("flex flex-col gap-2")],
		[
			sectionLabel(h, "Message History"),
			segmented(h, {
				ariaLabel: "Message history to import",
				segments: HistoryImport.literals.map((value) => ({ value, label: HISTORY_LABELS[value] })),
				selected: model.history,
				onSelect: (history) => Message.ClickedHistory({ history }),
				isDisabled: isSubmitting(model),
			}),
			description(h, {}, [historySummary(model.history, provider)]),
		],
	)

// --- Modal --------------------------------------------------------------------------------------

const submitLabel = (model: Model): string => {
	if (model.submission._tag === "CreatingChannel") return "Creating channel..."
	if (model.submission._tag === "Submitting") return "Linking..."
	return model.hazelChannelMode === "new" ? "Create and link" : "Link Channel"
}

const content = (
	h: HtmlBuilder<Message>,
	model: Model,
	provider: ChatSyncProvider,
	closeAttributes: ReadonlyArray<ChildAttribute>,
): ReadonlyArray<Html> => {
	const submitting = isSubmitting(model)
	return [
		dialogHeader(h, {}, [
			dialogTitle(h, { id: Modal.titleId(model.addLinkModal.id) }, "Link Channel"),
			dialogDescription(
				h,
				`Mirror messages between a ${PROVIDERS[provider].name} channel and a Hazel channel.`,
			),
		]),
		dialogBody(
			h,
			[
				externalSection(h, model, provider),
				hazelSection(h, model, provider),
				directionSection(h, model, provider),
				...(model.direction === "hazel_to_external" ? [] : [historySection(h, model, provider)]),
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
					isDisabled:
						!isLinkReady(model) || submitting || !AsyncData.isSuccess(model.externalChannels),
					isPending: submitting,
					interaction: { wiring: interaction.wiring(model), target: CREATE_LINK_TARGET },
				},
				[submitLabel(model)],
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
