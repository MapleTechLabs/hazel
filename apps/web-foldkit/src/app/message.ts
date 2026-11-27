import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { LayoutHotkeyActionId } from "../overlay/hotkeys"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toaster"
import { ToastRequest } from "../overlay/toasts"
import { PageOutMessage } from "../page/out-message"
import { Message as PageMessage } from "../page/registry"
import { AppRoute } from "../route"
import * as Platform from "../platform"
import { PresenceStatus } from "../platform/presence/model"
import { DesktopMenuItem } from "../platform/desktop-menu"
import * as Updates from "../platform/updates"
import * as Shell from "../shell/model"
import { HostContextSchema } from "./context"

/** Why `channel.createDm` failed. `AlreadyExists`: the server has a DM the synced rows don't show yet. */
export const CreateDmFailure = Schema.Union([Schema.Literals(["AlreadyExists"]), CommonReason])
export type CreateDmFailure = typeof CreateDmFailure.Type

/** The shell's own requests of the host: the keys and menu items whose work is still here. */
export const ShellRequest = Schema.Union([
	Schema.TaggedStruct("PressedHotkey", { actionId: LayoutHotkeyActionId }),
	Schema.TaggedStruct("PressedDesktopMenuItem", { item: DesktopMenuItem }),
	/** The update toast's "Install & Restart". */
	Schema.TaggedStruct("PressedInstallUpdate", {}),
	/** A phone section's top bar menu button: the sidebar sheet. */
	/** The DMs screen's compose button: today's Create DM modal. */
	Schema.TaggedStruct("PressedComposeDm", {}),
	/** Activity's sidebar: every unread notification read. */
	Schema.TaggedStruct("PressedMarkAllRead", {}),
	/** A toast the shell raised. */
	Schema.TaggedStruct("RequestedToast", { toast: ToastRequest }),
	/** A native page's request whose work is still the host's (a modal, the palette, a DM, updates). */
	Schema.TaggedStruct("RequestedPageOut", { outMessage: PageOutMessage }),
	/** The command palette's "Ask the AI assistant": the panel opens (never toggles shut). */
	Schema.TaggedStruct("RequestedAiPanel", {}),
	/** A status picked in the palette: presence keeps it ahead of the away timer. */
	Schema.TaggedStruct("PickedPresenceStatus", { status: PresenceStatus }),
])
export type ShellRequest = typeof ShellRequest.Type

export const Message = defineMessageUnion({
	/** The shell's route, session, organization, theme or clock changed. */
	ChangedContext: { context: HostContextSchema },
	ReceivedShellRequest: { request: ShellRequest },
	SucceededCreateDm: {
		organizationId: OrganizationId,
		orgSlug: Schema.String,
		userId: UserId,
		channelId: ChannelId,
		name: Schema.String,
	},
	FailedCreateDm: { organizationId: OrganizationId, userId: UserId, reason: CreateDmFailure },
	CompletedEmit: {},
	ClickedLayoutTab: { route: AppRoute },
	GotPageMessage: { message: PageMessage },
	GotShellMessage: { message: Shell.Message },
	GotModalMessage: { message: Modal.Message },
	GotToastsMessage: { message: Toasts.Message },
	GotPlatformMessage: { message: Platform.Message },
	GotUpdatesMessage: { message: Updates.Message },
})
export type Message = typeof Message.Type
