import type { UserId } from "@hazel/schema"
import { Option, Schema, Stream } from "effect"
import { Port, Subscription } from "foldkit"
import * as AiPanel from "../assistant"
import * as CommandPalette from "../overlay/command-palette"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toaster"
import { pageSubscriptions } from "../page/registry"
import * as Platform from "../platform"
import * as Updates from "../platform/updates"
import { chatChannelIdOf, orgSlugOf } from "../route"
import { backgroundToasts } from "../overlay/background-toasts"
import { messageOfIntent } from "../shell/channels-sidebar/intents"
import * as Bus from "../root/bus"
import * as ShellSubscription from "../shell/subscription"
import { HostContextSchema } from "./context"
import { Message } from "./message"
import { type Model, pageHostOf, sharedOf } from "./model"

/** The host's one inbound port: the shell's context, sent on every change. */
export const hostContext = Port.inbound(HostContextSchema)

const shellSubscriptions = Subscription.make<Model, Message>()(() => ({
	hostContext: Port.subscriptionEntry(hostContext, (context) => Message.ChangedContext({ context })),
	// The keys, menu items and frame buttons whose work is still the host's.
	shellRequests: Subscription.persistentEntry(
		Bus.eventsOf("Shell").pipe(Stream.map(({ request }) => Message.ReceivedShellRequest({ request }))),
	),
}))

/** The Effect UI channel sidebar's menu choices, run by this sidebar's menus (`intents.ts`). */
const channelSidebarActions = Subscription.make<Model, Message>()((entry) => ({
	channelSidebarActions: entry(
		{ orgSlug: Schema.NullOr(Schema.String) },
		{
			modelToDependencies: (model) => ({ orgSlug: orgSlugOf(model.context.route) ?? null }),
			dependenciesToStream: ({ orgSlug }) =>
				orgSlug === null
					? Stream.empty
					: Bus.eventsOf("ChannelSidebarAct").pipe(
							Stream.map(({ action }) => messageOfIntent(orgSlug, { _tag: "Act", action })),
							Stream.filter((message) => message !== null),
							Stream.map((message): Message => ({
								_tag: "GotShellMessage",
								message: { _tag: "GotChannelsSidebarMessage", message },
							})),
						),
		},
	),
	backgroundToasts: Subscription.persistentEntry(
		backgroundToasts.pipe(
			Stream.map((toast) =>
				Message.ReceivedShellRequest({ request: { _tag: "RequestedToast", toast } }),
			),
		),
	),
}))

const commandPaletteSubscriptions = Subscription.lift(CommandPalette.subscriptions)<Model, Message>({
	read: (model) => Option.some({ model: model.commandPalette, shared: sharedOf(model) }),
	toParentMessage: (message): Message => ({ _tag: "GotCommandPaletteMessage", message }),
})

const aiPanelSubscriptions = Subscription.lift(AiPanel.subscriptions)<Model, Message>({
	read: (model) =>
		Option.some({ model: model.aiPanel, organizationId: model.context.organization?.id ?? null }),
	// Literal wrapper: the constructor would re-validate every synced row.
	toParentMessage: (message): Message => ({ _tag: "GotAiPanelMessage", message }),
})

const modalSubscriptions = Subscription.lift(Modal.subscriptions)<Model, Message>({
	read: (model) => Option.some({ modal: model.modal, shared: sharedOf(model) }),
	toParentMessage: (message): Message => ({ _tag: "GotModalMessage", message }),
})

const sidebarSubscriptions = Subscription.lift(ShellSubscription.subscriptions)<Model, Message>({
	read: (model) => Option.some({ model: model.shell, route: model.context.route, shared: sharedOf(model) }),
	// Literal wrappers: constructors would re-validate every row payload.
	toParentMessage: (message): Message => ({ _tag: "GotShellMessage", message }),
})

/** `PresenceProvider` runs inside the loaded `$orgSlug` layout, once `user.me` answered. */
const presenceUserIdOf = (model: Model): UserId | null =>
	model.context.isShellReady ? (model.context.currentUser?.id ?? null) : null

const platformSubscriptions = Subscription.lift(Platform.subscriptions)<Model, Message>({
	read: (model) =>
		Option.some({
			model: model.platform,
			userId: presenceUserIdOf(model),
			activeChannelId: chatChannelIdOf(model.context.route),
		}),
	toParentMessage: (message): Message => ({ _tag: "GotPlatformMessage", message }),
})

const updateSubscriptions = Subscription.lift(Updates.subscriptions)<Model, Message>({
	read: (model) => Option.some(model.desktopUpdate),
	toParentMessage: (message): Message => ({ _tag: "GotUpdatesMessage", message }),
})

const toastSubscriptions = Subscription.lift(Toasts.subscriptions)<Model, Message>({
	read: (model) => Option.some(model.toasts),
	toParentMessage: (message): Message => ({ _tag: "GotToastsMessage", message }),
})

const pages = Subscription.lift(pageSubscriptions)<Model, Message>({
	read: (model) => Option.some(pageHostOf(model)),
	toParentMessage: (message): Message => ({ _tag: "GotPageMessage", message }),
})

export const subscriptions = Subscription.aggregate(
	shellSubscriptions,
	channelSidebarActions,
	commandPaletteSubscriptions,
	aiPanelSubscriptions,
	modalSubscriptions,
	toastSubscriptions,
	sidebarSubscriptions,
	pages,
	platformSubscriptions,
	updateSubscriptions,
)
