// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The app's one modal system: the root keeps the open modal in its Model and draws it over the
 * frame. Native pages (`OpenModal`), the Foldkit host's own opens and the root's keys all reach it.
 * The registry covers every `ModalRequest` kind; a new kind is one entry.
 */
import { Component, type View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import { ClientData } from "@hazel/client-data"
import { ClipboardWeb } from "@hazel/client-data/web/ui-services"
import type { ChannelId } from "@hazel/schema"
import type { Session } from "@hazel/shared-screens/app/session"
import { Layer, Schema } from "effect"
import { apiUrl } from "~/config/server"
import { clientData } from "~/db/client"
import { ModalRequest } from "../overlay/modal/requests"
import type { Platform as KeyboardPlatform } from "~/lib/keybindings/key-combo"
import type { Overrides } from "~/lib/keybindings/keymap"
import { AppRoute } from "../route"
import { botAvatarUploadsLayer } from "./bot-avatar"
import { AppMessage } from "./message"

/** The open modal: its request, and the opening it is (each opening mounts fresh). */
export const OpenModal = Schema.Struct({ instance: Schema.Int, request: ModalRequest })
export type OpenModal = typeof OpenModal.Type

type ModalTag = ModalRequest["_tag"]
type RequestOf<Tag extends ModalTag> = Extract<ModalRequest, { readonly _tag: Tag }>

/** The app's data for the modals' live queries and optimistic writes. */
const dataLayer = Layer.succeed(ClientData, clientData)
/** The bot token modals copy through the platform's clipboard. */
const clipboardLayer = Layer.merge(dataLayer, ClipboardWeb)
/** Edit bot also picks and stores the bot's avatar. */
const modalLayer = Layer.merge(dataLayer, botAvatarUploadsLayer)

// Nothing shows while a modal's chunk loads (a component child needs no fallback).
// The `import()`s are the only references to the modals' modules: a static import undoes the split.
const CreateChannelModal = Component.lazy("CreateChannelModal", () =>
	import("@hazel/shared-screens/modals/CreateChannelModal").then((module) =>
		module.CreateChannelModal.pipe(Component.provide(dataLayer)),
	),
)
const CreateDmModal = Component.lazy("CreateDmModal", () =>
	import("@hazel/shared-screens/modals/CreateDmModal").then((module) =>
		module.CreateDmModal.pipe(Component.provide(dataLayer)),
	),
)
const JoinChannelModal = Component.lazy("JoinChannelModal", () =>
	import("@hazel/shared-screens/modals/JoinChannelModal").then((module) =>
		module.JoinChannelModal.pipe(Component.provide(dataLayer)),
	),
)
const CreateSectionModal = Component.lazy("CreateSectionModal", () =>
	import("@hazel/shared-screens/modals/CreateSectionModal").then((module) =>
		module.CreateSectionModal.pipe(Component.provide(dataLayer)),
	),
)
const DeleteChannelModal = Component.lazy("DeleteChannelModal", () =>
	import("@hazel/shared-screens/modals/DeleteChannelModal").then((module) =>
		module.DeleteChannelModal.pipe(Component.provide(dataLayer)),
	),
)
const RenameChannelModal = Component.lazy("RenameChannelModal", () =>
	import("@hazel/shared-screens/modals/RenameChannelModal").then((module) =>
		module.RenameChannelModal.pipe(Component.provide(dataLayer)),
	),
)
const DeleteMessageModal = Component.lazy("DeleteMessageModal", () =>
	import("@hazel/shared-screens/modals/DeleteMessageModal").then((module) =>
		module.DeleteMessageModal.pipe(Component.provide(dataLayer)),
	),
)
const SetStatusModal = Component.lazy("SetStatusModal", () =>
	import("@hazel/shared-screens/modals/SetStatusModal").then((module) =>
		module.SetStatusModal.pipe(Component.provide(dataLayer)),
	),
)

// Needs attention's dialogs (PK2).
const MarkSignalDoneModal = Component.lazy("MarkSignalDoneModal", () =>
	import("@hazel/shared-screens/customers/queue/MarkSignalDoneModal").then((module) =>
		module.MarkSignalDoneModal.pipe(Component.provide(dataLayer)),
	),
)
const SnoozeUntilModal = Component.lazy("SnoozeUntilModal", () =>
	import("@hazel/shared-screens/customers/queue/SnoozeUntilModal").then((module) =>
		module.SnoozeUntilModal.pipe(Component.provide(dataLayer)),
	),
)

const CustomerRawDataModal = Component.lazy("CustomerRawDataModal", () =>
	import("@hazel/shared-screens/customers/modals/CustomerRawDataModal").then(
		(module) => module.CustomerRawDataModal,
	),
)
const CustomerLinkModal = Component.lazy("CustomerLinkModal", () =>
	import("@hazel/shared-screens/customers/modals/CustomerLinkModal").then((module) =>
		module.CustomerLinkModal.pipe(Component.provide(dataLayer)),
	),
)
const CustomerEnvironmentModal = Component.lazy("CustomerEnvironmentModal", () =>
	import("@hazel/shared-screens/customers/modals/CustomerEnvironmentModal").then((module) =>
		module.CustomerEnvironmentModal.pipe(Component.provide(dataLayer)),
	),
)

const ConnectSourceModal = Component.lazy("ConnectSourceModal", () =>
	import("@hazel/shared-screens/customers/settings/sources/ConnectSourceModal").then((module) =>
		module.ConnectSourceModal.pipe(Component.provide(Layer.mergeAll(dataLayer, ClipboardWeb))),
	),
)
const CreateBotModal = Component.lazy("CreateBotModal", () =>
	import("@hazel/shared-screens/modals/CreateBotModal").then((module) =>
		module.CreateBotModal.pipe(Component.provide(clipboardLayer)),
	),
)
const EditBotModal = Component.lazy("EditBotModal", () =>
	import("@hazel/shared-screens/modals/EditBotModal").then((module) =>
		module.EditBotModal.pipe(Component.provide(modalLayer)),
	),
)
const InstallBotByIdModal = Component.lazy("InstallBotByIdModal", () =>
	import("@hazel/shared-screens/modals/InstallBotByIdModal").then((module) =>
		module.InstallBotByIdModal.pipe(Component.provide(dataLayer)),
	),
)
const RegenerateBotTokenModal = Component.lazy("RegenerateBotTokenModal", () =>
	import("@hazel/shared-screens/modals/RegenerateBotTokenModal").then((module) =>
		module.RegenerateBotTokenModal.pipe(Component.provide(clipboardLayer)),
	),
)
const DeleteBotModal = Component.lazy("DeleteBotModal", () =>
	import("@hazel/shared-screens/modals/DeleteBotModal").then((module) =>
		module.DeleteBotModal.pipe(Component.provide(dataLayer)),
	),
)
const EmailInviteModal = Component.lazy("EmailInviteModal", () =>
	import("@hazel/shared-screens/modals/EmailInviteModal").then((module) =>
		module.EmailInviteModal.pipe(Component.provide(dataLayer)),
	),
)
const CreateOrganizationModal = Component.lazy("CreateOrganizationModal", () =>
	import("@hazel/shared-screens/modals/CreateOrganizationModal").then((module) =>
		module.CreateOrganizationModal.pipe(Component.provide(dataLayer)),
	),
)
const RequestIntegrationModal = Component.lazy("RequestIntegrationModal", () =>
	import("@hazel/shared-screens/modals/RequestIntegrationModal").then((module) =>
		module.RequestIntegrationModal.pipe(Component.provide(dataLayer)),
	),
)
const FeedbackModal = Component.lazy("FeedbackModal", () =>
	import("@hazel/shared-screens/modals/FeedbackModal").then((module) =>
		module.FeedbackModal.pipe(Component.provide(dataLayer)),
	),
)
const ChangeRoleModal = Component.lazy("ChangeRoleModal", () =>
	import("@hazel/shared-screens/modals/ChangeRoleModal").then((module) =>
		module.ChangeRoleModal.pipe(Component.provide(dataLayer)),
	),
)
const KeyboardShortcutsModal = Component.lazy("KeyboardShortcutsModal", () =>
	import("@hazel/shared-screens/modals/KeyboardShortcutsModal").then((module) =>
		module.KeyboardShortcutsModal.pipe(Component.provide(dataLayer)),
	),
)

/** What a modal reads: its request, the session and route it opened over, and the clock. */
export interface ModalInputs<Tag extends ModalTag> {
	readonly request: RequestOf<Tag>
	readonly session: Session
	readonly route: AppRoute
	readonly nowMs: number
	readonly isMobile: boolean
	readonly keybindingOverrides: Overrides
	readonly keyboardPlatform: KeyboardPlatform
}

interface Placement {
	readonly key: string
	readonly onEmit: { readonly RequestedClose: () => AppMessage }
}

type NativeModal<Tag extends ModalTag> = (
	h: Html.H<AppMessage>,
	inputs: ModalInputs<Tag>,
	placement: Placement,
) => View.Content<AppMessage, any>

type Registry = { readonly [Tag in ModalTag]: NativeModal<Tag> }

/** Legacy fuzzy `matchRoute` on `/$orgSlug/chat/$id` or `/$orgSlug/channels/$channelId/settings`. */
const routeChannelIdOf = (route: AppRoute): ChannelId | null =>
	AppRoute.isAnyOf([
		"ChatChannel",
		"ChatFiles",
		"ChatFilesMedia",
		"ChannelSettings",
		"ChannelSettingsOverview",
		"ChannelSettingsIntegrations",
		"ChannelSettingsConnect",
	])(route)
		? route.channelId
		: null

const nativeModals: Registry = {
	NewChannel: (h, { session }, placement) => CreateChannelModal(h, { ...placement, props: { session } }),
	CreateDm: (h, { session }, placement) => CreateDmModal(h, { ...placement, props: { session } }),
	JoinChannel: (h, { session }, placement) => JoinChannelModal(h, { ...placement, props: { session } }),
	CreateSection: (h, { session }, placement) => CreateSectionModal(h, { ...placement, props: { session } }),
	DeleteChannel: (h, { request, session, route }, placement) =>
		DeleteChannelModal(h, {
			...placement,
			props: {
				channelId: request.channelId,
				channelName: request.channelName,
				session,
				routeChannelId: routeChannelIdOf(route),
			},
		}),
	RenameChannel: (h, { request }, placement) =>
		RenameChannelModal(h, { ...placement, props: { channelId: request.channelId, kind: "channel" } }),
	RenameThread: (h, { request }, placement) =>
		RenameChannelModal(h, { ...placement, props: { channelId: request.threadId, kind: "thread" } }),
	DeleteMessage: (h, { request }, placement) =>
		DeleteMessageModal(h, { ...placement, props: { messageId: request.messageId } }),
	SetStatus: (h, { session, nowMs }, placement) =>
		SetStatusModal(h, { ...placement, props: { session, nowMs } }),
	MarkSignalDone: (h, { request, session }, placement) =>
		MarkSignalDoneModal(h, {
			...placement,
			props: {
				session,
				signalId: request.signalId,
				accountName: request.accountName,
				accountLogoUrl: request.accountLogoUrl,
				title: request.title,
				reason: request.reason,
				severity: request.severity,
			},
		}),
	SnoozeSignalUntil: (h, { request, session, nowMs }, placement) =>
		SnoozeUntilModal(h, {
			...placement,
			props: { session, signalId: request.signalId, title: request.title, nowMs },
		}),
	CustomerRawData: (h, { request }, placement) =>
		CustomerRawDataModal(h, { ...placement, props: { json: request.json } }),
	CustomerLink: (h, { request }, placement) =>
		CustomerLinkModal(h, {
			...placement,
			props: { organizationId: request.organizationId, accountId: request.accountId },
		}),
	CustomerEnvironment: (h, { request }, placement) =>
		CustomerEnvironmentModal(h, {
			...placement,
			props: {
				organizationId: request.organizationId,
				accountId: request.accountId,
				name: request.name,
				environment: request.environment,
			},
		}),
	CustomerSourceConnect: (h, { request, session }, placement) =>
		ConnectSourceModal(h, {
			...placement,
			props: {
				session,
				provider: request.provider,
				reconnectId: request.reconnectId,
				config: request.config,
				backendUrl: apiUrl(),
			},
		}),
	CreateBot: (h, { session }, placement) => CreateBotModal(h, { ...placement, props: { session } }),
	EditBot: (h, { request }, placement) =>
		EditBotModal(h, {
			...placement,
			props: {
				id: request.id,
				name: request.name,
				description: request.description,
				isPublic: request.isPublic,
				scopes: request.scopes,
				avatarUrl: request.avatarUrl,
			},
		}),
	InstallBotById: (h, { session }, placement) =>
		InstallBotByIdModal(h, { ...placement, props: { session } }),
	RegenerateBotToken: (h, { request }, placement) =>
		RegenerateBotTokenModal(h, {
			...placement,
			props: { botId: request.botId, botName: request.botName },
		}),
	DeleteBot: (h, { request }, placement) =>
		DeleteBotModal(h, { ...placement, props: { botId: request.botId, botName: request.botName } }),
	EmailInvite: (h, { session }, placement) => EmailInviteModal(h, { ...placement, props: { session } }),
	CreateOrganization: (h, { isMobile }, placement) =>
		CreateOrganizationModal(h, { ...placement, props: { isMobile } }),
	RequestIntegration: (h, { session }, placement) =>
		RequestIntegrationModal(h, { ...placement, props: { session } }),
	Feedback: (h, _inputs, placement) => FeedbackModal(h, { ...placement, props: {} }),
	ChangeRole: (h, { request }, placement) =>
		ChangeRoleModal(h, {
			...placement,
			props: {
				userId: request.userId,
				memberId: request.memberId,
				name: request.name,
				role: request.role,
				currentUserRole: request.currentUserRole,
			},
		}),
	KeyboardShortcuts: (h, { session, keybindingOverrides, keyboardPlatform }, placement) =>
		KeyboardShortcutsModal(h, {
			...placement,
			props: { overrides: keybindingOverrides, platform: keyboardPlatform, orgSlug: session.orgSlug },
		}),
}

/** Whether `tag` is a modal kind; the root draws every one (the Foldkit modal host is gone). */
export const isNativeModal = (tag: string): boolean => Object.hasOwn(nativeModals, tag)

/** The open modal's view, keyed by its opening, or null. */
export const modalOf = (
	h: Html.H<AppMessage>,
	open: OpenModal | null,
	inputs: Omit<ModalInputs<ModalTag>, "request">,
): View.Content<AppMessage, any> | null => {
	if (open === null) return null
	const draw = nativeModals[open.request._tag] as NativeModal<ModalTag>
	const { instance } = open
	return draw(
		h,
		{ ...inputs, request: open.request },
		{
			key: `${open.request._tag}:${instance}`,
			onEmit: { RequestedClose: () => AppMessage.RequestedCloseModal({ instance }) },
		},
	)
}
