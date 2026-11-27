// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Migrating from Slack or Discord (today's `web-foldkit/src/page/shared/chat-migration`): pick the
 * platform, connect it, pick the server, pick channels and history, go, and the progress step.
 * A parent renders it to start it (keyed by organization), and stops on `Finished` or `Skipped`.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { ExternalChannelId, OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Match, Schema, Stream } from "effect"
import { type AppToast, ShowToast } from "../../app/requests"
import { ChatMigrationBackend } from "./backend"
import {
	CHAT_SYNC_MIGRATION_MAX_CHANNELS,
	CHAT_SYNC_MIGRATION_MAX_MESSAGES,
	type ChatSyncHistoryRange,
	ChatSyncProvider,
	DEFAULT_HISTORY,
	ExternalChannel,
	filterByName,
	historyOptions,
	isBusy,
	isHistoryRange,
	MigrationResult,
	Phase,
	Problem,
	Remembered,
	Workspace,
} from "./model"
import { PROVIDER_ORDER, PROVIDERS } from "./providers"

export const ChatMigrationProps = Schema.Struct({
	/** Null until the page knows it; a provider the OAuth return names waits for it. */
	organizationId: Schema.NullOr(OrganizationId),
	/** The app path the provider's OAuth comes back to (the page that shows the wizard). */
	returnTo: Schema.String,
	/** Onboarding offers "Skip for now"; settings closes its dialog instead. */
	canSkip: Schema.Boolean,
})
export type ChatMigrationProps = typeof ChatMigrationProps.Type

export const ChatMigrationEvents = UiSchema.TaggedEnum({
	/** "Continue" on the progress step. */
	Finished: {},
	Skipped: {},
})
export type ChatMigrationEvents = typeof ChatMigrationEvents.Type

export const ChatMigrationMessage = UiSchema.TaggedEnum({
	CompletedReadOAuthReturn: { provider: Schema.NullOr(ChatSyncProvider) },
	/** The provider's OAuth came back refused or failed. */
	RefusedAtProvider: { provider: ChatSyncProvider, errorCode: Schema.NullOr(Schema.String) },
	/** The organization became known with a provider waiting on it. */
	ResumedProvider: { organizationId: OrganizationId, provider: ChatSyncProvider },
	PickedProvider: { selected: Schema.Array(Schema.String) },
	PressedBack: {},
	PressedSkip: {},
	SucceededListWorkspaces: {
		organizationId: OrganizationId,
		provider: ChatSyncProvider,
		workspaces: Schema.Array(Workspace),
	},
	FailedListWorkspaces: {
		organizationId: OrganizationId,
		provider: ChatSyncProvider,
		/** Null: not connected, so authorize it. */
		problem: Schema.NullOr(Problem),
	},
	PressedAuthorize: {},
	SucceededGetAuthorizationUrl: { organizationId: OrganizationId, url: Schema.String },
	FailedGetAuthorizationUrl: { organizationId: OrganizationId, problem: Problem },
	ChangedWorkspaceSearch: { payload: TextField.ChangePayload },
	PressedWorkspace: { id: Schema.String },
	SucceededPrepare: {
		organizationId: OrganizationId,
		workspaceId: Schema.String,
		syncConnectionId: SyncConnectionId,
		channels: Schema.Array(ExternalChannel),
	},
	FailedPrepare: { organizationId: OrganizationId, workspaceId: Schema.String, problem: Problem },
	PressedRetry: {},
	ChangedChannelSearch: { payload: TextField.ChangePayload },
	ToggledChannel: { id: ExternalChannelId, selected: Schema.Boolean },
	/** Every channel the search shows, or none of them. */
	ToggledAllChannels: { selected: Schema.Boolean },
	PickedHistory: { selected: Schema.Array(Schema.String) },
	PressedMigrate: {},
	SucceededMigrate: { organizationId: OrganizationId, result: MigrationResult },
	FailedMigrate: { organizationId: OrganizationId, problem: Problem },
	PressedImportMore: {},
	PressedContinue: {},
})
export type ChatMigrationMessage = typeof ChatMigrationMessage.Type

export const ChatMigrationModel = Schema.Struct({
	phase: Phase,
	workspaceSearch: TextField.State,
	channelSearch: TextField.State,
	/** Back from a provider's OAuth before the organization was known: resumed once it is. */
	resumeProvider: Schema.NullOr(ChatSyncProvider),
	remembered: Schema.NullOr(Remembered),
})
export type ChatMigrationModel = typeof ChatMigrationModel.Type

// COMMANDS

const isProvider = Schema.is(ChatSyncProvider)

export class ReadOAuthReturn extends Command.Service<ReadOAuthReturn>()(
	"hazel/chat-migration/ReadOAuthReturn",
	{
		args: {},
		success: ChatMigrationMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const backend = yield* ChatMigrationBackend
			return () =>
				backend.readOAuthReturn.pipe(
					Effect.map((back) =>
						Match.value(back).pipe(
							Match.tag("None", () =>
								ChatMigrationMessage.CompletedReadOAuthReturn({ provider: null }),
							),
							Match.tag("Returned", ({ provider }) =>
								ChatMigrationMessage.CompletedReadOAuthReturn({ provider }),
							),
							Match.tag("Refused", ({ provider, errorCode }) =>
								ChatMigrationMessage.RefusedAtProvider({ provider, errorCode }),
							),
							Match.exhaustive,
						),
					),
				)
		}),
	)
}

export class ListWorkspaces extends Command.Service<ListWorkspaces>()("hazel/chat-migration/ListWorkspaces", {
	args: { organizationId: OrganizationId, provider: ChatSyncProvider },
	success: ChatMigrationMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const backend = yield* ChatMigrationBackend
			return ({ organizationId, provider }) =>
				backend.listWorkspaces(organizationId, provider).pipe(
					Effect.match({
						onSuccess: (workspaces) =>
							ChatMigrationMessage.SucceededListWorkspaces({
								organizationId,
								provider,
								workspaces,
							}),
						onFailure: (failure) =>
							ChatMigrationMessage.FailedListWorkspaces({
								organizationId,
								provider,
								problem: failure._tag === "NotConnected" ? null : failure.problem,
							}),
					}),
				)
		}),
	)
}

export class PrepareWorkspace extends Command.Service<PrepareWorkspace>()(
	"hazel/chat-migration/PrepareWorkspace",
	{
		args: { organizationId: OrganizationId, provider: ChatSyncProvider, workspace: Workspace },
		success: ChatMigrationMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const backend = yield* ChatMigrationBackend
			return ({ organizationId, provider, workspace }) =>
				backend.prepare(organizationId, provider, workspace).pipe(
					Effect.match({
						onSuccess: ({ syncConnectionId, channels }) =>
							ChatMigrationMessage.SucceededPrepare({
								organizationId,
								workspaceId: workspace.id,
								syncConnectionId,
								channels,
							}),
						onFailure: (problem) =>
							ChatMigrationMessage.FailedPrepare({
								organizationId,
								workspaceId: workspace.id,
								problem,
							}),
					}),
				)
		}),
	)
}

export class GetAuthorizationUrl extends Command.Service<GetAuthorizationUrl>()(
	"hazel/chat-migration/GetAuthorizationUrl",
	{
		args: { organizationId: OrganizationId, provider: ChatSyncProvider, returnTo: Schema.String },
		success: ChatMigrationMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const backend = yield* ChatMigrationBackend
			return ({ organizationId, provider, returnTo }) =>
				backend.authorizationUrl(organizationId, provider, returnTo).pipe(
					Effect.match({
						onSuccess: (url) =>
							ChatMigrationMessage.SucceededGetAuthorizationUrl({ organizationId, url }),
						onFailure: (problem) =>
							ChatMigrationMessage.FailedGetAuthorizationUrl({ organizationId, problem }),
					}),
				)
		}),
	)
}

/** The browser leaves for the provider; the button stays pending until it has. */
export class RedirectToProvider extends Command.Service<RedirectToProvider>()(
	"hazel/chat-migration/RedirectToProvider",
	{ args: { url: Schema.String }, success: Component.Noop },
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const backend = yield* ChatMigrationBackend
			return ({ url }) => backend.redirect(url).pipe(Effect.as(Component.noop))
		}),
	)
}

export class RunMigration extends Command.Service<RunMigration>()("hazel/chat-migration/RunMigration", {
	args: {
		organizationId: OrganizationId,
		syncConnectionId: SyncConnectionId,
		channels: Schema.Array(
			Schema.Struct({ externalChannelId: ExternalChannelId, externalChannelName: Schema.String }),
		),
		history: Schema.Literals(["none", "7d", "30d", "90d", "1y", "all"]),
	},
	success: ChatMigrationMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const backend = yield* ChatMigrationBackend
			return (payload) =>
				backend.migrate(payload).pipe(
					Effect.match({
						onSuccess: (result) =>
							ChatMigrationMessage.SucceededMigrate({
								organizationId: payload.organizationId,
								result,
							}),
						onFailure: (problem) =>
							ChatMigrationMessage.FailedMigrate({
								organizationId: payload.organizationId,
								problem,
							}),
					}),
				)
		}),
	)
}

/** Every Command the wizard runs, over the host's `ChatMigrationBackend`. */
export const chatMigrationLayer = Layer.mergeAll(
	ReadOAuthReturn.layer,
	ListWorkspaces.layer,
	PrepareWorkspace.layer,
	GetAuthorizationUrl.layer,
	RedirectToProvider.layer,
	RunMigration.layer,
)

// UPDATE HELPERS

type Model = ChatMigrationModel
type Props = ChatMigrationProps

const toast = (intent: AppToast["intent"], title: string, description: string | null = null) =>
	ShowToast.make({ toast: { intent, title, description } })

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

/** The OAuth callback's `error_code`, as the person reads it. */
const oauthErrorCopy = (name: string, errorCode: string | null): string =>
	Match.value(errorCode).pipe(
		Match.when(
			"token_exchange_failed",
			() => `${name} did not authorize Hazel. Try again, and approve the request.`,
		),
		Match.when("account_info_failed", () => `Could not read your ${name} account. Please try again.`),
		Match.when("invalid_state", () => "The request expired. Please try again."),
		Match.whenOr(
			"db_error",
			"encryption_error",
			() => "Something went wrong saving the connection. Please try again.",
		),
		Match.orElse(() => "Please try again."),
	)

const migratedToast = (provider: ChatSyncProvider, history: ChatSyncHistoryRange, result: MigrationResult) =>
	result.linked === 0
		? result.takenElsewhere > 0
			? toast(
					"warning",
					"Nothing was migrated",
					`${plural(result.takenElsewhere, "channel")} already sync into another Hazel workspace.`,
				)
			: toast("success", "Those channels already sync")
		: toast(
				"success",
				`Migrating ${plural(result.linked, "channel")} from ${PROVIDERS[provider].name}`,
				history === "none" ? null : "Past messages import in the background.",
			)

const HISTORY_WINDOW: Record<ChatSyncHistoryRange, string | null> = {
	none: null,
	"7d": "the last 7 days",
	"30d": "the last 30 days",
	"90d": "the last 90 days",
	"1y": "the last year",
	all: "their history",
}

/** What the progress step says is importing: the range, bounded by the provider's per-channel cap. */
export const historyPhrase = (provider: ChatSyncProvider, history: ChatSyncHistoryRange): string => {
	const window = HISTORY_WINDOW[history]
	if (window === null) return "New messages sync from now on."
	const cap = CHAT_SYNC_MIGRATION_MAX_MESSAGES[provider].toLocaleString("en-US")
	return `Up to ${cap} messages a channel from ${window} are importing in the background.`
}

/** The progress step's summary line. */
export const doneSummary = (provider: ChatSyncProvider, result: MigrationResult): string => {
	const { linked, created, skipped, takenElsewhere } = result
	return [
		linked === 0
			? "Nothing changed."
			: `Linked ${plural(linked, `${PROVIDERS[provider].name} channel`)}${created === linked ? "." : ` (${created} new in Hazel).`}`,
		skipped > 0 ? ` ${plural(skipped, "channel")} already synced here, left as they were.` : "",
		// Another workspace's channel did not arrive: say so, never "already syncs".
		takenElsewhere > 0
			? ` ${plural(takenElsewhere, "channel")} already sync${takenElsewhere === 1 ? "s" : ""} into another Hazel workspace, so ${takenElsewhere === 1 ? "it was" : "they were"} left out.`
			: "",
	].join("")
}

// VIEW HELPERS

const ChatMigrationDef = Hazel.component({
	name: "ChatMigration",
	props: ChatMigrationProps,
	model: ChatMigrationModel,
	message: ChatMigrationMessage,
	events: ChatMigrationEvents,
	// After Back, a request that was in flight is not running any more: start over.
	restore: (model) => (isBusy(model.phase) ? { ...model, phase: Phase.ChoosingProvider() } : model),
})

type H = Parameters<Parameters<typeof ChatMigrationDef.make>[0]["view"]>[0]

interface Step {
	readonly title: string
	readonly description: string
	readonly body: ReadonlyArray<unknown>
	readonly leading: ReadonlyArray<unknown>
	readonly actions: ReadonlyArray<unknown>
}

const backButton = (h: H, phase: Phase) =>
	h.button
		.key("back")
		.label("Back")
		.icon("arrow-left")
		.variant("ghost")
		.disabled(isBusy(phase))
		.on("press", ChatMigrationMessage.PressedBack())

const spinner = (h: H, label: string) => h.progress.key("spinner").style("spinner").label(label)

/** A provider's logo over a short note, centred (today's `centered` with the large logo tile). */
const centered = (h: H, provider: ChatSyncProvider, ...lines: ReadonlyArray<unknown>) =>
	// HAZEL-GAP(p4-icon-tile-brand): today's logo tile is the provider's colour logo on a white ringed tile; `iconTile` draws the glyph.
	h.stack
		.key("centered")
		.align("center")
		.density("compact")
		.children(h.iconTile.name(provider), ...(lines as Array<never>))

const choosingProvider = (h: H, phase: Phase): Step => ({
	title: "Coming from Slack or Discord?",
	description: "Bring your channels and their history over, and keep them in sync while your team moves.",
	body: [
		h.choiceGroup
			.key("providers")
			.label("Platform")
			.style("cards")
			.options(
				PROVIDER_ORDER.map((provider) => ({
					value: provider,
					label: `Import from ${PROVIDERS[provider].name}`,
					description: PROVIDERS[provider].blurb,
					icon: provider,
				})),
			)
			.selected([])
			.on("change", ({ selected }) => ChatMigrationMessage.PickedProvider({ selected })),
	],
	leading: h.props.canSkip
		? [
				h.button
					.key("skip")
					.label("Skip for now")
					.variant("ghost")
					.disabled(isBusy(phase))
					.on("press", ChatMigrationMessage.PressedSkip()),
			]
		: [],
	actions: [],
})

const pickingChannels = (
	h: H,
	model: Model,
	phase: Extract<Phase, { readonly _tag: "PickingChannels" }>,
): Step => {
	const { name, channelNote } = PROVIDERS[phase.provider]
	const search = model.channelSearch.text
	const shown = filterByName(phase.channels, search)
	const selected = new Set<string>(phase.selected)
	const shownSelected = shown.filter((channel) => selected.has(channel.id)).length
	const allShown = shown.length > 0 && shownSelected === shown.length
	const count = phase.selected.length
	const isOverLimit = count > CHAT_SYNC_MIGRATION_MAX_CHANNELS
	const row = (channel: ExternalChannel) =>
		h.item
			.key(channel.id)
			.title(channel.name)
			.leading(h.icon.name(channel.isPrivate ? "lock" : "hashtag"))
			.disabled(phase.isSubmitting)
			.trailing(
				h.toggle
					.style("checkbox")
					.label(`Bring #${channel.name}`)
					.checked(selected.has(channel.id))
					.disabled(phase.isSubmitting)
					.on("change", ({ checked }) =>
						ChatMigrationMessage.ToggledChannel({ id: channel.id, selected: checked }),
					),
			)
			.on(
				"press",
				ChatMigrationMessage.ToggledChannel({ id: channel.id, selected: !selected.has(channel.id) }),
			)
	return {
		title: `Choose what to bring from ${phase.workspace.name}`,
		description: `Each ${name} channel gets a Hazel channel, kept in sync both ways from now on.`,
		body: [
			h.stack
				.key("channels")
				.density("compact")
				.children(
					h.stack.axis("horizontal").children(
						h.text.role("label").children("Channels"),
						h.spacer,
						h.text
							.role("caption")
							.tone(isOverLimit ? "danger" : "muted")
							.children(
								isOverLimit
									? `${count} selected, up to ${CHAT_SYNC_MIGRATION_MAX_CHANNELS} at a time`
									: `${count} of ${phase.channels.length} selected`,
							),
					),
					h.searchField
						.key("channel-search")
						.placeholder("Search channels...")
						.value(model.channelSearch)
						.on("change", (payload) => ChatMigrationMessage.ChangedChannelSearch({ payload })),
					// HAZEL-GAP(p4-scroll-list-cap): today's list scrolls inside a bordered box capped at 16rem.
					h.frame
						.key("channel-list")
						.surface("flush")
						.children(
							h.toggle
								.key("select-all")
								.style("checkbox")
								.label(search.trim() === "" ? "Select all" : "Select all matching")
								.checked(allShown)
								.indeterminate(shownSelected > 0 && !allShown)
								.disabled(phase.isSubmitting || shown.length === 0)
								.on("change", ({ checked }) =>
									ChatMigrationMessage.ToggledAllChannels({ selected: checked }),
								),
							h.divider.key("select-all-divider"),
							shown.length === 0
								? h.text
										.key("none")
										.role("caption")
										.tone("muted")
										.children(
											phase.channels.length === 0
												? `No ${name} channels Hazel can see`
												: "No channels match",
										)
								: h.scroll.key("rows").children(...shown.map(row)),
						),
					channelNote === null
						? null
						: h.text.key("note").role("caption").tone("muted").children(channelNote),
				),
			h.choiceGroup
				.key("history")
				.label("History to import")
				.style("cards")
				.columns("2")
				.disabled(phase.isSubmitting)
				.options(
					historyOptions(phase.provider).map((option) => ({
						value: option.value,
						label: option.label,
						description: option.description,
					})),
				)
				.selected([phase.history])
				.on("change", ({ selected }) => ChatMigrationMessage.PickedHistory({ selected })),
		],
		leading: [backButton(h, phase)],
		actions: [
			h.button
				.key("migrate")
				.label(
					phase.isSubmitting
						? "Starting..."
						: count === 0
							? "Pick a channel"
							: isOverLimit
								? `Pick up to ${CHAT_SYNC_MIGRATION_MAX_CHANNELS}`
								: `Migrate ${plural(count, "channel")}`,
				)
				.loading(phase.isSubmitting)
				.disabled(count === 0 || isOverLimit || phase.isSubmitting)
				.on("press", ChatMigrationMessage.PressedMigrate()),
		],
	}
}

const stepOf = (h: H, model: Model): Step =>
	Phase.match(model.phase, {
		ChoosingProvider: () => choosingProvider(h, model.phase),
		Loading: ({ provider }) => ({
			title: `Import from ${PROVIDERS[provider].name}`,
			description: "Checking what's connected...",
			body: [
				spinner(
					h,
					`Looking for your ${PROVIDERS[provider].name} ${PROVIDERS[provider].workspaceKind}...`,
				),
			],
			leading: [backButton(h, model.phase)],
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
				body: [
					centered(
						h,
						provider,
						h.text
							.role("caption")
							.tone("muted")
							.children(
								`Hazel reads the channels you pick and keeps them in sync. You can disconnect ${name} at any time.`,
							),
					),
				],
				leading: [backButton(h, model.phase)],
				actions: [
					h.button
						.key("authorize")
						.label(isRedirecting ? "Opening..." : `Connect ${name}`)
						.loading(isRedirecting)
						.on("press", ChatMigrationMessage.PressedAuthorize()),
				],
			}
		},
		PickingWorkspace: ({ provider, workspaces }) => ({
			title: `Pick a ${PROVIDERS[provider].name} ${PROVIDERS[provider].workspaceKind}`,
			description: `The ${PROVIDERS[provider].workspaceKind}s Hazel's bot is in.`,
			body: [
				h.searchField
					.key("workspace-search")
					.placeholder("Search servers...")
					.value(model.workspaceSearch)
					.on("change", (payload) => ChatMigrationMessage.ChangedWorkspaceSearch({ payload })),
				h.frame
					.key("workspaces")
					.surface("flush")
					.children(
						...filterByName(workspaces, model.workspaceSearch.text).map((workspace) =>
							h.item
								.key(workspace.id)
								.title(workspace.name)
								.trailing(
									workspace.owner
										? h.badge.label("Owner").style("quiet").size("small")
										: undefined,
								)
								.on("press", ChatMigrationMessage.PressedWorkspace({ id: workspace.id })),
						),
					),
			],
			leading: [backButton(h, model.phase)],
			actions: [],
		}),
		Preparing: ({ provider, workspace }) => ({
			title: `Import from ${workspace.name}`,
			description: `Loading the ${PROVIDERS[provider].name} channels...`,
			body: [spinner(h, "Loading channels...")],
			leading: [backButton(h, model.phase)],
			actions: [],
		}),
		PickingChannels: (phase) => pickingChannels(h, model, phase),
		Failed: ({ provider, problem }) => ({
			title: `Import from ${PROVIDERS[provider].name}`,
			description: "That didn't work.",
			body: [
				centered(
					h,
					provider,
					h.heading.level("3").children(problem.title),
					problem.description === ""
						? null
						: h.text.role("caption").tone("muted").children(problem.description),
				),
			],
			leading: [backButton(h, model.phase)],
			actions: problem.canRetry
				? [h.button.key("retry").label("Try again").on("press", ChatMigrationMessage.PressedRetry())]
				: [],
		}),
		Done: ({ provider, workspaceName, result, history }) => ({
			title:
				result.linked === 0 && result.takenElsewhere > 0 ? "Nothing was migrated" : "You're all set",
			description:
				result.linked > 0
					? `${workspaceName} is on its way to Hazel.`
					: result.takenElsewhere > 0
						? "Those channels belong to another Hazel workspace."
						: `${workspaceName} already syncs with Hazel.`,
			body: [
				h.stack
					.key("done")
					.align("center")
					.density("compact")
					.children(
						h.iconTile.name("check").tone("success"),
						h.text.children(doneSummary(provider, result)),
						// Nothing linked means nothing was queued: no import to promise.
						result.linked === 0
							? null
							: h.text.role("caption").tone("muted").children(historyPhrase(provider, history)),
					),
			],
			leading: [],
			actions: [
				h.button
					.key("import-more")
					.label("Import more")
					.variant("secondary")
					.on("press", ChatMigrationMessage.PressedImportMore()),
				h.button
					.key("continue")
					.label("Continue")
					.on("press", ChatMigrationMessage.PressedContinue()),
			],
		}),
	})

// UPDATE

type Do = Component.Update<ChatMigrationModel, ChatMigrationMessage, ChatMigrationEvents, ChatMigrationProps>

const withPhase = ($: Do, phase: Phase) => $.evolve({ phase: () => phase })

const load = ($: Do, provider: ChatSyncProvider) => {
	const organizationId = $.props.organizationId
	return organizationId === null
		? $.run(toast("error", "No active organization"))
		: $.evolve({ phase: () => Phase.Loading({ provider }), resumeProvider: () => null }).run(
				ListWorkspaces.make({ organizationId, provider }),
			)
}

const prepare = (
	$: Do,
	provider: ChatSyncProvider,
	workspace: Workspace,
	workspaces: ReadonlyArray<Workspace>,
) => {
	const organizationId = $.props.organizationId
	return organizationId === null
		? $.run(toast("error", "No active organization"))
		: withPhase($, Phase.Preparing({ provider, workspace, workspaces })).run(
				PrepareWorkspace.make({ organizationId, provider, workspace }),
			)
}

/** A reply about another organization, or another step, is dropped. */
const isCurrent = (props: Props, organizationId: OrganizationId) => props.organizationId === organizationId

export const ChatMigrationNoDeps = ChatMigrationDef.make({
	init: ($) =>
		$.set({
			phase: Phase.ChoosingProvider(),
			workspaceSearch: TextField.empty,
			channelSearch: TextField.empty,
			resumeProvider: null,
			remembered: null,
		}).run(ReadOAuthReturn.make({})),
	update: {
		CompletedReadOAuthReturn: ($, { provider }) =>
			provider === null || $.model.phase._tag !== "ChoosingProvider"
				? $.model
				: $.props.organizationId === null
					? $.evolve({ resumeProvider: () => provider })
					: load($, provider),
		RefusedAtProvider: ($, { provider, errorCode }) => {
			const { name } = PROVIDERS[provider]
			return withPhase($, Phase.NeedsAuthorization({ provider, isRedirecting: false })).run(
				toast("error", `Couldn't connect ${name}`, oauthErrorCopy(name, errorCode)),
			)
		},
		ResumedProvider: ($, { organizationId, provider }) =>
			!isCurrent($.props, organizationId) ||
			$.model.resumeProvider !== provider ||
			$.model.phase._tag !== "ChoosingProvider"
				? $.model
				: load($, provider),
		PickedProvider: ($, { selected }) => {
			const provider = selected.find(isProvider)
			return provider === undefined || isBusy($.model.phase) ? $.model : load($, provider)
		},
		PressedBack: ($) => {
			const { phase } = $.model
			if (isBusy(phase)) return $.model
			if (phase._tag !== "PickingChannels") return withPhase($, Phase.ChoosingProvider())
			// The picks are kept for this workspace; Back goes to the server list it came from when
			// there was a choice, else to the start.
			return $.evolve({
				remembered: () => ({
					workspaceId: phase.workspace.id,
					selected: phase.selected,
					history: phase.history,
				}),
				channelSearch: () => TextField.empty,
				phase: () =>
					phase.workspaces.length > 1
						? Phase.PickingWorkspace({ provider: phase.provider, workspaces: phase.workspaces })
						: Phase.ChoosingProvider(),
			})
		},
		PressedSkip: ($) => (isBusy($.model.phase) ? $.model : $.emit(ChatMigrationEvents.Skipped())),
		SucceededListWorkspaces: ($, { organizationId, provider, workspaces }) => {
			const { phase } = $.model
			if (
				!isCurrent($.props, organizationId) ||
				phase._tag !== "Loading" ||
				phase.provider !== provider
			)
				return $.model
			const [only] = workspaces
			if (only === undefined)
				return withPhase($, Phase.NeedsAuthorization({ provider, isRedirecting: false }))
			if (workspaces.length === 1 || !PROVIDERS[provider].picksWorkspace)
				return prepare($, provider, only, workspaces)
			return $.evolve({
				workspaceSearch: () => TextField.empty,
				phase: () => Phase.PickingWorkspace({ provider, workspaces }),
			})
		},
		FailedListWorkspaces: ($, { organizationId, provider, problem }) => {
			const { phase } = $.model
			if (
				!isCurrent($.props, organizationId) ||
				phase._tag !== "Loading" ||
				phase.provider !== provider
			)
				return $.model
			return withPhase(
				$,
				problem === null
					? Phase.NeedsAuthorization({ provider, isRedirecting: false })
					: Phase.Failed({ provider, problem, workspace: null, workspaces: [] }),
			)
		},
		PressedAuthorize: ($) => {
			const { phase } = $.model
			const organizationId = $.props.organizationId
			if (phase._tag !== "NeedsAuthorization" || phase.isRedirecting || organizationId === null)
				return $.model
			return withPhase($, Phase.NeedsAuthorization({ ...phase, isRedirecting: true })).run(
				GetAuthorizationUrl.make({
					organizationId,
					provider: phase.provider,
					returnTo: $.props.returnTo,
				}),
			)
		},
		// Another organization's consent URL must never be followed (it would connect it there).
		SucceededGetAuthorizationUrl: ($, { organizationId, url }) =>
			$.model.phase._tag === "NeedsAuthorization" && isCurrent($.props, organizationId)
				? $.run(RedirectToProvider.make({ url }))
				: $.model,
		FailedGetAuthorizationUrl: ($, { organizationId, problem }) => {
			const { phase } = $.model
			if (!isCurrent($.props, organizationId) || phase._tag !== "NeedsAuthorization") return $.model
			return withPhase($, Phase.NeedsAuthorization({ ...phase, isRedirecting: false })).run(
				toast("error", problem.title, problem.description || null),
			)
		},
		ChangedWorkspaceSearch: ($, { payload }) =>
			$.evolve({ workspaceSearch: (state) => TextField.changed(state, payload) }),
		PressedWorkspace: ($, { id }) => {
			const { phase } = $.model
			if (phase._tag !== "PickingWorkspace") return $.model
			const workspace = phase.workspaces.find((entry) => entry.id === id)
			return workspace === undefined ? $.model : prepare($, phase.provider, workspace, phase.workspaces)
		},
		SucceededPrepare: ($, { organizationId, workspaceId, syncConnectionId, channels }) => {
			const { phase } = $.model
			if (
				!isCurrent($.props, organizationId) ||
				phase._tag !== "Preparing" ||
				phase.workspace.id !== workspaceId
			)
				return $.model
			// The picks left on Back come back for the same workspace; otherwise everything, to start.
			const remembered = $.model.remembered?.workspaceId === workspaceId ? $.model.remembered : null
			const listed = new Set<string>(channels.map((channel) => channel.id))
			return $.evolve({
				remembered: () => null,
				channelSearch: () => TextField.empty,
				phase: () =>
					Phase.PickingChannels({
						provider: phase.provider,
						workspace: phase.workspace,
						workspaces: phase.workspaces,
						syncConnectionId,
						channels,
						selected:
							remembered === null
								? channels.map((channel) => channel.id)
								: remembered.selected.filter((id) => listed.has(id)),
						history: remembered?.history ?? DEFAULT_HISTORY,
						isSubmitting: false,
					}),
			})
		},
		FailedPrepare: ($, { organizationId, workspaceId, problem }) => {
			const { phase } = $.model
			if (
				!isCurrent($.props, organizationId) ||
				phase._tag !== "Preparing" ||
				phase.workspace.id !== workspaceId
			)
				return $.model
			return withPhase(
				$,
				Phase.Failed({
					provider: phase.provider,
					workspace: phase.workspace,
					workspaces: phase.workspaces,
					problem,
				}),
			)
		},
		PressedRetry: ($) => {
			const { phase } = $.model
			if (phase._tag !== "Failed") return $.model
			return phase.workspace === null
				? load($, phase.provider)
				: prepare($, phase.provider, phase.workspace, phase.workspaces)
		},
		ChangedChannelSearch: ($, { payload }) =>
			$.evolve({ channelSearch: (state) => TextField.changed(state, payload) }),
		ToggledChannel: ($, { id, selected }) => {
			const { phase } = $.model
			if (phase._tag !== "PickingChannels" || phase.isSubmitting) return $.model
			const rest = phase.selected.filter((entry) => entry !== id)
			return withPhase(
				$,
				Phase.PickingChannels({ ...phase, selected: selected ? [...rest, id] : rest }),
			)
		},
		ToggledAllChannels: ($, { selected }) => {
			const { phase } = $.model
			if (phase._tag !== "PickingChannels" || phase.isSubmitting) return $.model
			const shown = filterByName(phase.channels, $.model.channelSearch.text).map(
				(channel) => channel.id,
			)
			const shownSet = new Set<string>(shown)
			const rest = phase.selected.filter((id) => !shownSet.has(id))
			return withPhase(
				$,
				Phase.PickingChannels({ ...phase, selected: selected ? [...rest, ...shown] : rest }),
			)
		},
		PickedHistory: ($, { selected }) => {
			const { phase } = $.model
			const history = selected.find(isHistoryRange)
			return phase._tag !== "PickingChannels" || phase.isSubmitting || history === undefined
				? $.model
				: withPhase($, Phase.PickingChannels({ ...phase, history }))
		},
		PressedMigrate: ($) => {
			const { phase } = $.model
			const organizationId = $.props.organizationId
			if (
				phase._tag !== "PickingChannels" ||
				phase.isSubmitting ||
				phase.selected.length === 0 ||
				phase.selected.length > CHAT_SYNC_MIGRATION_MAX_CHANNELS ||
				organizationId === null
			)
				return $.model
			const selected = new Set<string>(phase.selected)
			return withPhase($, Phase.PickingChannels({ ...phase, isSubmitting: true })).run(
				RunMigration.make({
					organizationId,
					syncConnectionId: phase.syncConnectionId,
					channels: phase.channels
						.filter((channel) => selected.has(channel.id))
						.map((channel) => ({
							externalChannelId: channel.id,
							externalChannelName: channel.name,
						})),
					history: phase.history,
				}),
			)
		},
		SucceededMigrate: ($, { organizationId, result }) => {
			const { phase } = $.model
			if (
				!isCurrent($.props, organizationId) ||
				phase._tag !== "PickingChannels" ||
				!phase.isSubmitting
			)
				return $.model
			return withPhase(
				$,
				Phase.Done({
					provider: phase.provider,
					workspaceName: phase.workspace.name,
					result,
					history: phase.history,
				}),
			).run(migratedToast(phase.provider, phase.history, result))
		},
		FailedMigrate: ($, { organizationId, problem }) => {
			const { phase } = $.model
			if (!isCurrent($.props, organizationId) || phase._tag !== "PickingChannels") return $.model
			return withPhase($, Phase.PickingChannels({ ...phase, isSubmitting: false })).run(
				toast("error", problem.title, problem.description || null),
			)
		},
		PressedImportMore: ($) => withPhase($, Phase.ChoosingProvider()),
		PressedContinue: ($) => $.emit(ChatMigrationEvents.Finished()),
	},
	// A provider back from OAuth waits for the organization; this resumes it once both are known.
	subscriptions: ({ props, model }) => {
		const { organizationId } = props
		const provider = model.resumeProvider
		return [
			organizationId === null || provider === null
				? null
				: Subscription.make("resume", [organizationId, provider], ([org, waiting]) =>
						Stream.make(
							ChatMigrationMessage.ResumedProvider({ organizationId: org, provider: waiting }),
						),
					),
		]
	},
	view: (h, model) => {
		const step = stepOf(h, model)
		const footer =
			step.leading.length === 0 && step.actions.length === 0
				? null
				: h.stack
						.key("footer")
						.axis("horizontal")
						.children(
							...(step.leading as Array<never>),
							h.spacer,
							...(step.actions as Array<never>),
						)
		return h.stack
			.key("chat-migration")
			.density("relaxed")
			.children(
				h.stack
					.key("header")
					.density("tight")
					.children(
						h.heading.level("2").children(step.title),
						h.text.tone("muted").children(step.description),
					),
				...(step.body as Array<never>),
				footer,
			)
	},
})

/** The wizard with its Commands, over the host's `ChatMigrationBackend` (and `ShowToast`). */
export const ChatMigration = ChatMigrationNoDeps.pipe(Component.provide(chatMigrationLayer))
