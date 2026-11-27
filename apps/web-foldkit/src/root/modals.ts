// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The app's one modal system: the root keeps the open modal in its Model and draws it over the
 * frame. Native pages (`OpenModal`), the Foldkit host's own opens and the root's keys all reach it.
 * A kind not registered here still opens in the Foldkit host. Converting a modal is one entry.
 */
import { Component, type View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import { ClientData } from "@hazel/client-data"
import type { ChannelId } from "@hazel/schema"
import type { Session } from "@hazel/shared-screens/app/session"
import { Layer, Schema } from "effect"
import { clientData } from "~/db/client"
import { ModalRequest } from "../overlay/modal/requests"
import { AppRoute } from "../route"
import { AppMessage } from "./message"

/** The open modal: its request, and the opening it is (each opening mounts fresh). */
export const OpenModal = Schema.Struct({ instance: Schema.Int, request: ModalRequest })
export type OpenModal = typeof OpenModal.Type

type ModalTag = ModalRequest["_tag"]
type RequestOf<Tag extends ModalTag> = Extract<ModalRequest, { readonly _tag: Tag }>

/** The app's data for the modals' live queries and optimistic writes. */
const dataLayer = Layer.succeed(ClientData, clientData)

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

/** What a modal reads: its request, the session and route it opened over, and the clock. */
export interface ModalInputs<Tag extends ModalTag> {
	readonly request: RequestOf<Tag>
	readonly session: Session
	readonly route: AppRoute
	readonly nowMs: number
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

type Registry = { readonly [Tag in ModalTag]?: NativeModal<Tag> }

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
}

/** The parity flag of a native modal: `"0"` opens today's Foldkit modal instead (`compare-pages.ts`). */
export const modalParityFlag = (tag: ModalTag) => `hazel:native:modal:${tag}`

// The parity runner sets the flag before the app loads.
const forcedOff = (tag: ModalTag): boolean =>
	typeof localStorage !== "undefined" && localStorage.getItem(modalParityFlag(tag)) === "0"

/** Whether the root draws this kind; the Foldkit host draws the rest. */
export const isNativeModal = (tag: string): boolean =>
	Object.hasOwn(nativeModals, tag) && !forcedOff(tag as ModalTag)

/** The open modal's view, keyed by its opening, or null. */
export const modalOf = (
	h: Html.H<AppMessage>,
	open: OpenModal | null,
	inputs: Omit<ModalInputs<ModalTag>, "request">,
): View.Content<AppMessage, any> | null => {
	if (open === null) return null
	const draw = nativeModals[open.request._tag] as NativeModal<ModalTag> | undefined
	if (draw === undefined) return null
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
