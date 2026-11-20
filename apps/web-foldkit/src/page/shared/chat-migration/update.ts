import type { OrganizationId } from "@hazel/schema"
import type { Command } from "foldkit"
import { errorToast, successToast } from "../../../data/actions"
import type { ToastRequest } from "../../../overlay/toasts"
import type { Resources } from "../../../rpc"
import {
	type ChatSyncProvider,
	isRetryable,
	PROVIDERS,
	resourceFailureMessage,
	type Workspace,
} from "../../settings/chat-sync/providers"
import {
	GetChatMigrationOAuthUrl,
	ListChatMigrationWorkspaces,
	RunChatMigration,
	PrepareChatMigrationWorkspace,
	ReadChatMigrationOAuthReturn,
	RedirectChatMigrationToProvider,
} from "./command"
import {
	CHAT_SYNC_MIGRATION_MAX_CHANNELS,
	DEFAULT_HISTORY,
	isBusy,
	isHistoryRange,
	Message,
	type Model,
	Phase,
	visibleChannels,
} from "./model"

/** What the embedding page does after a step: nothing, a toast, or the wizard is over. */
export type Outcome =
	| { readonly _tag: "Toast"; readonly toast: ToastRequest }
	| { readonly _tag: "Finished" }
	| { readonly _tag: "Skipped" }

export interface Return {
	readonly model: Model
	readonly commands?: ReadonlyArray<Command.Command<Message, never, Resources>>
	readonly outcome?: Outcome
}

const toast = (request: ToastRequest): Outcome => ({ _tag: "Toast", toast: request })

const withPhase = (model: Model, phase: Phase): Model => ({ ...model, phase })

/** On mount: a page that came back from a provider's OAuth carries on with that provider. */
export const start = (model: Model): Return => ({ model, commands: [ReadChatMigrationOAuthReturn()] })

const load = (model: Model, provider: ChatSyncProvider): Return =>
	model.organizationId === null
		? { model, outcome: toast(errorToast("No active organization")) }
		: {
				model: withPhase(model, Phase.Loading({ provider })),
				commands: [ListChatMigrationWorkspaces({ organizationId: model.organizationId, provider })],
			}

const prepare = (model: Model, provider: ChatSyncProvider, workspace: Workspace): Return =>
	model.organizationId === null
		? { model, outcome: toast(errorToast("No active organization")) }
		: {
				model: withPhase(model, Phase.Preparing({ provider, workspace })),
				commands: [
					PrepareChatMigrationWorkspace({
						organizationId: model.organizationId,
						provider,
						workspace,
					}),
				],
			}

/**
 * The page's organization (and return path) as it becomes known; a pending OAuth return resumes.
 * Switching to another organization starts the wizard over: nothing chosen under one carries into
 * the other, and the earlier organization's replies are dropped (each names its organization).
 */
export const withOrganization = (
	model: Model,
	organizationId: OrganizationId | null,
	returnTo: string,
): Return => {
	const isSwitch = model.organizationId !== null && model.organizationId !== organizationId
	const next: Model = isSwitch
		? { ...model, organizationId, returnTo, phase: Phase.ChoosingProvider(), resumeProvider: null }
		: { ...model, organizationId, returnTo }
	const provider = model.resumeProvider
	return provider !== null && organizationId !== null && model.phase._tag === "ChoosingProvider"
		? load({ ...next, resumeProvider: null }, provider)
		: { model: next }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		ReturnedFromProvider: ({ provider }) =>
			provider === null || model.phase._tag !== "ChoosingProvider"
				? { model }
				: model.organizationId === null
					? { model: { ...model, resumeProvider: provider } }
					: load(model, provider),
		ClickedProvider: ({ provider }) => (isBusy(model) ? { model } : load(model, provider)),
		ClickedBack: () => {
			if (isBusy(model)) return { model }
			const { phase } = model
			// Channels go back to the server list when there was one to pick from, else to the start.
			if (phase._tag === "PickingChannels" && PROVIDERS[phase.provider].picksWorkspace)
				return load(model, phase.provider)
			return { model: withPhase(model, Phase.ChoosingProvider()) }
		},
		ClickedSkip: () => (isBusy(model) ? { model } : { model, outcome: { _tag: "Skipped" } }),

		SucceededListWorkspaces: ({ organizationId, provider, workspaces }) => {
			const { phase } = model
			if (
				organizationId !== model.organizationId ||
				phase._tag !== "Loading" ||
				phase.provider !== provider
			)
				return { model }
			const [only] = workspaces
			if (only === undefined)
				return {
					model: withPhase(model, Phase.NeedsAuthorization({ provider, isRedirecting: false })),
				}
			if (workspaces.length === 1 || !PROVIDERS[provider].picksWorkspace)
				return prepare(model, provider, only)
			return { model: withPhase(model, Phase.PickingWorkspace({ provider, workspaces, search: "" })) }
		},
		FailedListWorkspaces: ({ organizationId, provider, reason }) => {
			const { phase } = model
			if (
				organizationId !== model.organizationId ||
				phase._tag !== "Loading" ||
				phase.provider !== provider
			)
				return { model }
			if (reason === "NotConnected")
				return {
					model: withPhase(model, Phase.NeedsAuthorization({ provider, isRedirecting: false })),
				}
			const failure = resourceFailureMessage(provider, reason, PROVIDERS[provider].workspacesResource)
			return {
				model: withPhase(
					model,
					Phase.Failed({
						provider,
						workspace: null,
						problem: {
							title: failure.title,
							description: failure.description ?? "",
							canRetry: isRetryable(reason) || reason === "ProviderError",
						},
					}),
				),
			}
		},

		ClickedAuthorize: () => {
			const { phase } = model
			if (phase._tag !== "NeedsAuthorization" || phase.isRedirecting || model.organizationId === null)
				return { model }
			return {
				model: withPhase(model, Phase.NeedsAuthorization({ ...phase, isRedirecting: true })),
				commands: [
					GetChatMigrationOAuthUrl({
						organizationId: model.organizationId,
						provider: phase.provider,
						returnTo: model.returnTo,
					}),
				],
			}
		},
		// Another organization's consent URL must never be followed (it would connect it there).
		SucceededGetOAuthUrl: ({ organizationId, authorizationUrl }) =>
			model.phase._tag === "NeedsAuthorization" && organizationId === model.organizationId
				? { model, commands: [RedirectChatMigrationToProvider({ authorizationUrl })] }
				: { model },
		FailedGetOAuthUrl: ({ organizationId, problem }) => {
			const { phase } = model
			if (organizationId !== model.organizationId || phase._tag !== "NeedsAuthorization")
				return { model }
			return {
				model: withPhase(model, Phase.NeedsAuthorization({ ...phase, isRedirecting: false })),
				outcome: toast(errorToast(problem.title, problem.description || null)),
			}
		},
		// The browser is leaving for the provider; the button stays pending until it has.
		CompletedRedirect: () => ({ model }),

		ChangedWorkspaceSearch: ({ value }) =>
			model.phase._tag === "PickingWorkspace"
				? { model: withPhase(model, Phase.PickingWorkspace({ ...model.phase, search: value })) }
				: { model },
		ClickedWorkspace: ({ workspace }) =>
			model.phase._tag === "PickingWorkspace"
				? prepare(model, model.phase.provider, workspace)
				: { model },

		SucceededPrepare: ({ organizationId, workspaceId, syncConnectionId, channels }) => {
			const { phase } = model
			if (
				organizationId !== model.organizationId ||
				phase._tag !== "Preparing" ||
				phase.workspace.id !== workspaceId
			)
				return { model }
			return {
				model: withPhase(
					model,
					Phase.PickingChannels({
						provider: phase.provider,
						workspace: phase.workspace,
						syncConnectionId,
						channels,
						// Everything, to start: a migration usually brings the whole workspace.
						selected: channels.map((channel) => channel.id),
						search: "",
						history: DEFAULT_HISTORY,
						isSubmitting: false,
					}),
				),
			}
		},
		FailedPrepare: ({ organizationId, workspaceId, problem }) => {
			const { phase } = model
			if (
				organizationId !== model.organizationId ||
				phase._tag !== "Preparing" ||
				phase.workspace.id !== workspaceId
			)
				return { model }
			return {
				model: withPhase(
					model,
					Phase.Failed({ provider: phase.provider, workspace: phase.workspace, problem }),
				),
			}
		},
		ClickedRetry: () => {
			const { phase } = model
			if (phase._tag !== "Failed") return { model }
			return phase.workspace === null
				? load(model, phase.provider)
				: prepare(model, phase.provider, phase.workspace)
		},

		ChangedChannelSearch: ({ value }) =>
			model.phase._tag === "PickingChannels"
				? { model: withPhase(model, Phase.PickingChannels({ ...model.phase, search: value })) }
				: { model },
		ToggledChannel: ({ channelId, isSelected }) => {
			const { phase } = model
			if (phase._tag !== "PickingChannels" || phase.isSubmitting) return { model }
			const rest = phase.selected.filter((id) => id !== channelId)
			return {
				model: withPhase(
					model,
					Phase.PickingChannels({ ...phase, selected: isSelected ? [...rest, channelId] : rest }),
				),
			}
		},
		ToggledAll: ({ isSelected }) => {
			const { phase } = model
			if (phase._tag !== "PickingChannels" || phase.isSubmitting) return { model }
			const shown = new Set(visibleChannels(phase.channels, phase.search).map((channel) => channel.id))
			const rest = phase.selected.filter((id) => !shown.has(id))
			return {
				model: withPhase(
					model,
					Phase.PickingChannels({ ...phase, selected: isSelected ? [...rest, ...shown] : rest }),
				),
			}
		},
		ClickedHistory: ({ history }) =>
			model.phase._tag === "PickingChannels" && !model.phase.isSubmitting && isHistoryRange(history)
				? { model: withPhase(model, Phase.PickingChannels({ ...model.phase, history })) }
				: { model },
		ClickedMigrate: () => {
			const { phase } = model
			if (
				phase._tag !== "PickingChannels" ||
				phase.isSubmitting ||
				phase.selected.length === 0 ||
				phase.selected.length > CHAT_SYNC_MIGRATION_MAX_CHANNELS ||
				model.organizationId === null
			)
				return { model }
			const selected = new Set(phase.selected)
			return {
				model: withPhase(model, Phase.PickingChannels({ ...phase, isSubmitting: true })),
				commands: [
					RunChatMigration({
						organizationId: model.organizationId,
						syncConnectionId: phase.syncConnectionId,
						channels: phase.channels
							.filter((channel) => selected.has(channel.id))
							.map((channel) => ({
								externalChannelId: channel.id,
								externalChannelName: channel.name,
							})),
						history: phase.history,
					}),
				],
			}
		},
		SucceededMigrate: ({ organizationId, linked, created, skipped }) => {
			const { phase } = model
			if (
				organizationId !== model.organizationId ||
				phase._tag !== "PickingChannels" ||
				!phase.isSubmitting
			)
				return { model }
			return {
				model: withPhase(
					model,
					Phase.Done({
						provider: phase.provider,
						workspaceName: phase.workspace.name,
						linked,
						created,
						skipped,
						history: phase.history,
					}),
				),
				outcome: toast(
					successToast(
						`Migrating ${plural(linked, "channel")} from ${PROVIDERS[phase.provider].name}`,
						phase.history === "none" ? null : "Past messages import in the background.",
					),
				),
			}
		},
		FailedMigrate: ({ organizationId, problem }) => {
			const { phase } = model
			if (organizationId !== model.organizationId || phase._tag !== "PickingChannels") return { model }
			return {
				model: withPhase(model, Phase.PickingChannels({ ...phase, isSubmitting: false })),
				outcome: toast(errorToast(problem.title, problem.description || null)),
			}
		},
		ClickedFinish: () => ({ model, outcome: { _tag: "Finished" } }),
		ClickedMigrateMore: () => ({ model: withPhase(model, Phase.ChoosingProvider()) }),
	})
