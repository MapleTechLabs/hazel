import type { Html, HtmlBuilder } from "foldkit/html"
import { IconArrowLeft, IconCheck, IconHashtag, IconLock } from "../../../icons"
import { ariaButton, button } from "../../../ui/button"
import { checkbox } from "../../../ui/checkbox"
import { description, label } from "../../../ui/field"
import { heading } from "../../../ui/heading"
import { loader } from "../../../ui/loader"
import { radioGroup } from "../../../ui/radio"
import { filterByName, scrollList, searchInput } from "../../settings/chat-sync/modal-parts"
import {
	type ChatSyncProvider,
	ChatSyncProvider as ChatSyncProviders,
	type ExternalChannel,
	PROVIDERS,
	type Workspace,
} from "../../settings/chat-sync/providers"
import { HISTORY_OPTIONS, isBusy, Message, type Model, Phase, type Problem, visibleChannels } from "./model"

/**
 * The wizard as parts its page lays out: the step's title and description, its body, its Back (or
 * Skip) on the left, and its actions on the right (the step's main action last).
 */
export interface Parts {
	readonly title: string
	readonly description: string
	readonly body: Html
	readonly leading: ReadonlyArray<Html>
	readonly actions: ReadonlyArray<Html>
}

export interface ViewOptions<P> {
	readonly toParentMessage: (message: Message) => P
	/** Onboarding offers "Skip for now"; settings closes its modal instead. */
	readonly canSkip: boolean
}

type Builder<P> = HtmlBuilder<P>

const logoTile = <P>(h: Builder<P>, provider: ChatSyncProvider, size: "md" | "lg" = "md"): Html =>
	h.div(
		[
			h.Class(
				`flex shrink-0 items-center justify-center rounded-xl bg-bg shadow-xs ring-1 ring-border ${size === "lg" ? "size-12" : "size-10"}`,
			),
		],
		[PROVIDERS[provider].logo(h, size === "lg" ? "size-7" : "size-6")],
	)

const centered = <P>(h: Builder<P>, children: ReadonlyArray<Html>): Html =>
	h.div([h.Class("flex flex-col items-center gap-3 py-10 text-center")], [...children])

const spinner = <P>(h: Builder<P>, text: string): Html =>
	centered(h, [
		loader(h, { className: "size-6 text-muted-fg" }),
		h.p([h.Class("text-muted-fg text-sm")], [text]),
	])

const PROVIDER_BLURB = {
	slack: "Bring over your workspace's public channels.",
	discord: "Bring over the channels of a server you manage.",
} satisfies Record<ChatSyncProvider, string>

const providerCard = <P>(h: Builder<P>, provider: ChatSyncProvider, wrap: (m: Message) => P): Html =>
	ariaButton(
		h,
		{
			onPress: wrap(Message.ClickedProvider({ provider })),
			className:
				"group flex w-full items-center gap-4 rounded-xl border border-border bg-bg p-4 text-left transition-[border-color,box-shadow] duration-150 hover:border-border-hover hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring",
			attributes: [h.DataAttribute("testid", `chat-migration-provider-${provider}`)],
		},
		[
			logoTile(h, provider),
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col gap-0.5")],
				[
					h.span(
						[h.Class("font-medium text-fg text-sm")],
						[`Import from ${PROVIDERS[provider].name}`],
					),
					h.span([h.Class("text-muted-fg text-sm")], [PROVIDER_BLURB[provider]]),
				],
			),
		],
	)

const backButton = <P>(h: Builder<P>, model: Model, wrap: (m: Message) => P): Html =>
	button(h, { intent: "plain", isDisabled: isBusy(model), onPress: wrap(Message.ClickedBack()) }, [
		IconArrowLeft(h, { className: "size-4" }),
		"Back",
	])

const skipButton = <P>(h: Builder<P>, model: Model, options: ViewOptions<P>): ReadonlyArray<Html> =>
	options.canSkip
		? [
				button(
					h,
					{
						intent: "plain",
						isDisabled: isBusy(model),
						onPress: options.toParentMessage(Message.ClickedSkip()),
					},
					["Skip for now"],
				),
			]
		: []

const problemBody = <P>(h: Builder<P>, provider: ChatSyncProvider, problem: Problem): Html =>
	centered(h, [
		logoTile(h, provider, "lg"),
		heading(h, { variant: "subsection" }, [problem.title]),
		...(problem.description === ""
			? []
			: [h.p([h.Class("max-w-sm text-muted-fg text-sm")], [problem.description])]),
	])

const workspaceRow = <P>(h: Builder<P>, workspace: Workspace, wrap: (m: Message) => P): Html =>
	h.keyed("div")(
		workspace.id,
		[],
		[
			ariaButton(
				h,
				{
					onPress: wrap(Message.ClickedWorkspace({ workspace })),
					className:
						"flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-secondary/50",
				},
				[
					h.span([h.Class("truncate text-fg")], [workspace.name]),
					...(workspace.owner
						? [
								h.span(
									[h.Class("rounded-sm bg-secondary px-1.5 py-0.5 text-3xs text-muted-fg")],
									["Owner"],
								),
							]
						: []),
				],
			),
		],
	)

const channelRow = <P>(
	h: Builder<P>,
	model: Model,
	channel: ExternalChannel,
	isSelected: boolean,
	isDisabled: boolean,
	wrap: (m: Message) => P,
): Html =>
	h.keyed("div")(
		channel.id,
		[h.Class("border-border border-b px-3 py-2 last:border-b-0")],
		[
			checkbox(
				h,
				{
					id: `${model.id}-channel-${channel.id}`,
					isSelected,
					isDisabled,
					onChange: (selected) =>
						wrap(Message.ToggledChannel({ channelId: channel.id, isSelected: selected })),
					className: "w-full",
				},
				[
					h.span(
						[h.Class("ml-2 flex min-w-0 items-center gap-1.5 text-fg text-sm")],
						[
							(channel.isPrivate ? IconLock : IconHashtag)(h, {
								className: "size-3.5 shrink-0 text-muted-fg",
							}),
							h.span([h.Class("truncate")], [channel.name]),
						],
					),
				],
			),
		],
	)

const pickingChannels = <P>(
	h: Builder<P>,
	model: Model,
	phase: Extract<Phase, { readonly _tag: "PickingChannels" }>,
	options: ViewOptions<P>,
): Parts => {
	const wrap = options.toParentMessage
	const { name, copy } = PROVIDERS[phase.provider]
	const shown = visibleChannels(phase.channels, phase.search)
	const selected = new Set(phase.selected)
	const shownSelected = shown.filter((channel) => selected.has(channel.id)).length
	const allShownSelected = shown.length > 0 && shownSelected === shown.length
	const count = phase.selected.length
	return {
		title: `Choose what to bring from ${phase.workspace.name}`,
		description: `Each ${name} channel gets a Hazel channel, kept in sync both ways from now on.`,
		body: h.div(
			[h.Class("flex flex-col gap-6")],
			[
				h.div(
					[h.Class("flex flex-col gap-2")],
					[
						h.div(
							[h.Class("flex items-center justify-between gap-3")],
							[
								label(h, {}, ["Channels"]),
								h.span(
									[h.Class("text-muted-fg text-xs")],
									[`${count} of ${phase.channels.length} selected`],
								),
							],
						),
						searchInput(h, {
							id: `${model.id}-channel-search`,
							placeholder: "Search channels...",
							value: phase.search,
							isFocused: false,
							onInput: (value) => wrap(Message.ChangedChannelSearch({ value })),
						}),
						h.div(
							[h.Class("overflow-hidden rounded-lg border border-border")],
							[
								h.div(
									[h.Class("border-border border-b bg-bg-muted/40 px-3 py-2")],
									[
										checkbox(
											h,
											{
												id: `${model.id}-select-all`,
												isSelected: allShownSelected,
												isIndeterminate: shownSelected > 0 && !allShownSelected,
												isDisabled: phase.isSubmitting || shown.length === 0,
												onChange: (isSelected) =>
													wrap(Message.ToggledAll({ isSelected })),
											},
											phase.search.trim() === "" ? "Select all" : "Select all matching",
										),
									],
								),
								scrollList(
									h,
									"max-h-64 rounded-none border-0",
									phase.channels.length === 0
										? `No ${name} channels Hazel can see`
										: "No channels match",
									shown.map((channel) =>
										channelRow(
											h,
											model,
											channel,
											selected.has(channel.id),
											phase.isSubmitting,
											wrap,
										),
									),
								),
							],
						),
						...(copy.channelNote === null ? [] : [description(h, {}, [copy.channelNote])]),
					],
				),
				radioGroup(
					h,
					{
						id: `${model.id}-history`,
						value: phase.history,
						isDisabled: phase.isSubmitting,
						onChange: (history) => wrap(Message.ClickedHistory({ history })),
					},
					(parts) => [
						parts.label(["History to import"]),
						h.div(
							[h.Class("grid grid-cols-1 gap-2 sm:grid-cols-2")],
							HISTORY_OPTIONS.map((option) =>
								parts.radio(
									option.value,
									[
										h.span(
											[h.Class("flex flex-col")],
											[
												h.span(
													[h.Class("font-medium text-fg text-sm")],
													[option.label],
												),
												h.span(
													[h.Class("text-muted-fg text-xs")],
													[option.description],
												),
											],
										),
									],
									{
										className:
											"rounded-lg border border-border px-3 py-2.5 data-selected:border-primary",
									},
								),
							),
						),
					],
				),
			],
		),
		leading: [backButton(h, model, wrap)],
		actions: [
			button(
				h,
				{
					intent: "primary",
					isDisabled: count === 0,
					isPending: phase.isSubmitting,
					onPress: wrap(Message.ClickedMigrate()),
					attributes: [h.DataAttribute("testid", "chat-migration-go")],
				},
				[
					phase.isSubmitting
						? "Starting..."
						: count === 0
							? "Pick a channel"
							: `Migrate ${count} channel${count === 1 ? "" : "s"}`,
				],
			),
		],
	}
}

const HISTORY_PHRASE = {
	none: "New messages sync from now on.",
	"7d": "The last 7 days of messages are importing in the background.",
	"30d": "The last 30 days of messages are importing in the background.",
	"90d": "The last 90 days of messages are importing in the background.",
	"1y": "The last year of messages is importing in the background; busy channels take a while.",
	all: "Their full history is importing in the background; busy channels take a while.",
} satisfies Record<Extract<Phase, { readonly _tag: "Done" }>["history"], string>

export const parts = <P>(h: Builder<P>, model: Model, options: ViewOptions<P>): Parts => {
	const wrap = options.toParentMessage
	return Phase.match<Parts>(model.phase, {
		ChoosingProvider: () => ({
			title: "Coming from Slack or Discord?",
			description:
				"Bring your channels and their history over, and keep them in sync while your team moves.",
			body: h.div(
				[h.Class("flex flex-col gap-3")],
				ChatSyncProviders.literals.map((provider) => providerCard(h, provider, wrap)),
			),
			leading: skipButton(h, model, options),
			actions: [],
		}),
		Loading: ({ provider }) => ({
			title: `Import from ${PROVIDERS[provider].name}`,
			description: "Checking what's connected...",
			body: spinner(
				h,
				`Looking for your ${PROVIDERS[provider].name} ${PROVIDERS[provider].workspaceKind}...`,
			),
			leading: [backButton(h, model, wrap)],
			actions: [],
		}),
		NeedsAuthorization: ({ provider, isRedirecting }) => {
			const { name, workspaceKind } = PROVIDERS[provider]
			return {
				title: `Connect ${name}`,
				description:
					provider === "discord"
						? `Add Hazel's bot to the ${workspaceKind} you want to bring over. You'll come right back here.`
						: `Install Hazel in your ${name} ${workspaceKind}. You'll come right back here.`,
				body: centered(h, [
					logoTile(h, provider, "lg"),
					h.p(
						[h.Class("max-w-sm text-muted-fg text-sm")],
						[
							`Hazel reads the channels you pick and keeps them in sync. You can disconnect ${name} at any time.`,
						],
					),
				]),
				leading: [backButton(h, model, wrap)],
				actions: [
					button(
						h,
						{
							intent: "primary",
							isPending: isRedirecting,
							onPress: wrap(Message.ClickedAuthorize()),
							attributes: [h.DataAttribute("testid", "chat-migration-authorize")],
						},
						[isRedirecting ? "Opening..." : `Connect ${name}`],
					),
				],
			}
		},
		PickingWorkspace: ({ provider, workspaces, search }) => ({
			title: `Pick a ${PROVIDERS[provider].name} ${PROVIDERS[provider].workspaceKind}`,
			description: `The ${PROVIDERS[provider].workspaceKind}s Hazel's bot is in.`,
			body: h.div(
				[h.Class("flex flex-col gap-2")],
				[
					searchInput(h, {
						id: `${model.id}-workspace-search`,
						placeholder: "Search servers...",
						value: search,
						isFocused: false,
						onInput: (value) => wrap(Message.ChangedWorkspaceSearch({ value })),
					}),
					scrollList(
						h,
						"max-h-64",
						"No servers match",
						filterByName(workspaces, search).map((workspace) => workspaceRow(h, workspace, wrap)),
					),
				],
			),
			leading: [backButton(h, model, wrap)],
			actions: [],
		}),
		Preparing: ({ provider, workspace }) => ({
			title: `Import from ${workspace.name}`,
			description: `Loading the ${PROVIDERS[provider].name} channels...`,
			body: spinner(h, "Loading channels..."),
			leading: [backButton(h, model, wrap)],
			actions: [],
		}),
		PickingChannels: (phase) => pickingChannels(h, model, phase, options),
		Failed: ({ provider, problem }) => ({
			title: `Import from ${PROVIDERS[provider].name}`,
			description: "That didn't work.",
			body: problemBody(h, provider, problem),
			leading: [backButton(h, model, wrap)],
			actions: [
				...(problem.canRetry
					? [button(h, { intent: "primary", onPress: wrap(Message.ClickedRetry()) }, ["Try again"])]
					: []),
			],
		}),
		Done: ({ provider, workspaceName, linked, created, skipped, history }) => ({
			title: "You're all set",
			description: `${workspaceName} is on its way to Hazel.`,
			body: centered(h, [
				h.div(
					[
						h.Class(
							"flex size-12 items-center justify-center rounded-full bg-success/10 text-success",
						),
					],
					[IconCheck(h, { className: "size-6" })],
				),
				h.p(
					[h.Class("max-w-sm text-fg text-sm")],
					[
						`Linked ${linked} ${PROVIDERS[provider].name} channel${linked === 1 ? "" : "s"}`,
						created === linked ? "." : ` (${created} new in Hazel).`,
						skipped > 0 ? ` ${skipped} already synced, left as they were.` : "",
					],
				),
				h.p([h.Class("max-w-sm text-muted-fg text-sm")], [HISTORY_PHRASE[history]]),
			]),
			leading: [],
			actions: [
				button(h, { intent: "secondary", onPress: wrap(Message.ClickedMigrateMore()) }, [
					"Import more",
				]),
				button(
					h,
					{
						intent: "primary",
						onPress: wrap(Message.ClickedFinish()),
						attributes: [h.DataAttribute("testid", "chat-migration-finish")],
					},
					["Continue"],
				),
			],
		}),
	})
}
