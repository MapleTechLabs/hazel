import * as AsyncData from "foldkit/asyncData"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { button } from "../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader, dialogTitle } from "../../../ui/dialog"
import { description, label } from "../../../ui/field"
import * as Modal from "../../../ui/modal"
import { WORKSPACE_SEARCH_ID } from "./add-connection"
import { filterByName, scrollList, searchInput, selectedName, selectedRow, spinnerLine } from "./modal-parts"
import { chosenWorkspace, Message, type Model } from "./model"
import {
	type ChatSyncProvider,
	isRetryable,
	PROVIDERS,
	type ResourceFailure,
	resourceFailureMessage,
	type Workspace,
} from "./providers"
import { CONNECT_TARGET, interaction, WORKSPACE_SEARCH_TARGET } from "./update"

/** Port of `components/chat-sync/add-connection-modal.tsx`, for each provider. */

const toAddModalMessage = (message: Modal.Message) => Message.GotAddModalMessage({ message })
const toWorkspaceSearchMessage = (value: string) => Message.ChangedWorkspaceSearch({ value })

const workspaceRow = (h: HtmlBuilder<Message>, workspace: Workspace): Html =>
	h.keyed("button")(
		workspace.id,
		[
			h.Type("button"),
			h.OnClick(Message.ClickedWorkspace({ workspace })),
			h.Class(
				"flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/50",
			),
		],
		[
			h.span([h.Class("truncate text-fg")], [workspace.name]),
			...(workspace.owner
				? [
						h.span(
							[h.Class("rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-fg")],
							["Owner"],
						),
					]
				: []),
		],
	)

/** Discord: search the servers the bot is in and pick one. */
const workspacePicker = (
	h: HtmlBuilder<Message>,
	model: Model,
	workspaces: ReadonlyArray<Workspace>,
): ReadonlyArray<Html> => {
	const { name, workspaceKind } = PROVIDERS[model.addProvider]
	return [
		...(model.selectedWorkspace === null
			? [
					searchInput(h, {
						id: WORKSPACE_SEARCH_ID,
						placeholder: "Search servers...",
						value: model.workspaceSearch,
						isFocused: model.isWorkspaceSearchFocused,
						onInput: toWorkspaceSearchMessage,
						onFocus: Message.FocusedWorkspaceSearch(),
						onBlur: Message.BlurredWorkspaceSearch(),
						hover: { wiring: interaction.wiring(model), target: WORKSPACE_SEARCH_TARGET },
					}),
					scrollList(
						h,
						"max-h-56",
						`No ${name} servers found`,
						filterByName(workspaces, model.workspaceSearch).map((workspace) =>
							workspaceRow(h, workspace),
						),
					),
				]
			: [
					selectedRow(
						h,
						[selectedName(h, model.selectedWorkspace.name)],
						Message.ClickedChangeWorkspace(),
					),
				]),
		description(h, {}, [`Select the ${name} ${workspaceKind} you want to sync with Hazel.`]),
	]
}

/** Slack: the one workspace the organization installed Hazel in. */
const installedWorkspace = (h: HtmlBuilder<Message>, model: Model): ReadonlyArray<Html> => {
	const workspace = chosenWorkspace(model)
	const { name, logo } = PROVIDERS[model.addProvider]
	return [
		h.div(
			[h.Class("flex items-center gap-2 rounded-lg border border-border bg-bg-muted/30 px-3 py-2.5")],
			[logo(h, "size-4 shrink-0"), selectedName(h, workspace?.name ?? "")],
		),
		description(h, {}, [
			`Hazel is installed in this workspace. To sync another one, reconnect ${name} in Integrations.`,
		]),
	]
}

const workspaceSection = (
	h: HtmlBuilder<Message>,
	model: Model,
	workspaces: ReadonlyArray<Workspace>,
): Html => {
	const provider = PROVIDERS[model.addProvider]
	return h.div(
		[h.Class("flex flex-col gap-3")],
		[
			label(h, {}, [provider.workspaceTitle]),
			...(provider.picksWorkspace
				? workspacePicker(h, model, workspaces)
				: installedWorkspace(h, model)),
		],
	)
}

const notice = (
	h: HtmlBuilder<Message>,
	title: string,
	text: string | undefined,
	action: Html | null,
): Html =>
	h.div(
		[h.Class("rounded-lg border border-border bg-bg-muted/20 p-4")],
		[
			h.p([h.Class("font-medium text-fg text-sm")], [title]),
			...(text === undefined ? [] : [h.p([h.Class("mt-1 text-muted-fg text-sm")], [text])]),
			...(action === null ? [] : [action]),
		],
	)

const noticeButton = (h: HtmlBuilder<Message>, onPress: Message, text: string): Html =>
	button(h, { intent: "secondary", size: "sm", className: "mt-3", onPress }, [text])

/** The provider is not connected to the organization: link to its integration page. */
const connectFirst = (h: HtmlBuilder<Message>, provider: ChatSyncProvider): Html => {
	const { name, workspacesResource } = PROVIDERS[provider]
	const message = resourceFailureMessage(provider, "NotConnected", workspacesResource)
	return notice(
		h,
		message.title,
		message.description,
		noticeButton(h, Message.ClickedOpenIntegration(), `Open ${name} Integration`),
	)
}

/** A workspace list that failed for another reason than the provider not being connected. */
const loadFailed = (h: HtmlBuilder<Message>, provider: ChatSyncProvider, reason: ResourceFailure): Html => {
	const message = resourceFailureMessage(provider, reason, PROVIDERS[provider].workspacesResource)
	return notice(
		h,
		message.title,
		message.description,
		isRetryable(reason) ? noticeButton(h, Message.ClickedRetryListWorkspaces(), "Try again") : null,
	)
}

const loadingWorkspaces = (h: HtmlBuilder<Message>, provider: ChatSyncProvider): Html => {
	const { name, workspacesResource } = PROVIDERS[provider]
	return h.div(
		[h.Class("flex items-center justify-center py-8")],
		[spinnerLine(h, `Loading ${name} ${workspacesResource}...`)],
	)
}

const body = (h: HtmlBuilder<Message>, model: Model): Html =>
	AsyncData.match(model.workspaces, {
		onIdle: () => loadingWorkspaces(h, model.addProvider),
		onLoading: () => loadingWorkspaces(h, model.addProvider),
		onFailure: (reason) =>
			reason === "NotConnected"
				? connectFirst(h, model.addProvider)
				: loadFailed(h, model.addProvider, reason),
		onRefreshing: (workspaces) => workspaceSection(h, model, workspaces),
		onStale: ({ data }) => workspaceSection(h, model, data),
		onSuccess: (workspaces) => workspaceSection(h, model, workspaces),
	})

const content = (
	h: HtmlBuilder<Message>,
	model: Model,
	closeAttributes: ReadonlyArray<ChildAttribute>,
): ReadonlyArray<Html> => {
	const isSubmitting = model.submission._tag === "Submitting"
	const provider = PROVIDERS[model.addProvider]
	return [
		dialogHeader(h, {}, [
			h.div(
				[h.Class("flex items-center gap-3")],
				[
					h.div(
						[
							h.Class(
								`flex size-10 items-center justify-center rounded-xl ${provider.tintClass}`,
							),
						],
						[provider.logo(h, "size-6")],
					),
					dialogTitle(
						h,
						{ id: Modal.titleId(model.addModal.id) },
						`Connect ${provider.workspaceTitle}`,
					),
				],
			),
		]),
		dialogBody(h, [body(h, model)], "flex flex-col gap-5"),
		dialogFooter(h, [
			dialogClose(h, closeAttributes, ["Cancel"], "secondary"),
			button(
				h,
				{
					intent: "primary",
					onPress: Message.ClickedConnect(),
					isDisabled:
						chosenWorkspace(model) === null ||
						isSubmitting ||
						!AsyncData.isSuccess(model.workspaces),
					isPending: isSubmitting,
					interaction: { wiring: interaction.wiring(model), target: CONNECT_TARGET },
				},
				[isSubmitting ? "Connecting..." : "Connect"],
			),
		]),
	]
}

/** `<Modal><ModalContent isOpen onOpenChange size="md">`, rendered while open. */
export const addConnectionModal = (h: HtmlBuilder<Message>, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.addModal,
		toParentMessage: toAddModalMessage,
		toContent: (closeAttributes) => content(h, model, closeAttributes),
		size: "md",
	})
