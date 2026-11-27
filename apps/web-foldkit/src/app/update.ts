import type { ChannelId } from "@hazel/schema"
import { Match, Option } from "effect"
import { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { errorToastOf, loadingToast, successToast } from "../data/actions"
import type { PalettePage } from "@hazel/shared-screens/app/requests"
import type { LayoutHotkeyActionId } from "../overlay/hotkeys"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toaster"
import type { ToastAction } from "../overlay/toasts"
import { ModalOutMessage } from "../overlay/out-message"
import type { ToastRequest } from "../overlay/toasts"
import { can } from "../page/contract"
import { PageOutMessage, type RequestedDmCreation } from "../page/out-message"
import { enterRoute, informShared, type PageSlot, type PageTransition, updatePage } from "../page/registry"
import * as Platform from "../platform"
import type { DesktopMenuItem } from "../platform/desktop-menu"
import * as Updates from "../platform/updates"
import { AppRoute, chatChannelIdOf, organizationRoute, orgSlugOf } from "../route"
import type { Resources } from "../rpc"
import * as ChannelNavigation from "../shell/channels-sidebar/navigation"
import { Message as ShellMessage, type Model as ShellModel } from "../shell/model"
import * as Notifications from "../shell/notifications"
import * as Shell from "../shell/update"
import { isNativeModal } from "../root/modals"
import { CreateDm, emit } from "./command"
import type { HostContext } from "./context"
import { type Message, type ShellRequest } from "./message"
import { dmRequestKey, type Model, reportOf, sharedOf } from "./model"
import { toPageMessage } from "./view"

type Return = Update.Return<Model, Message, Resources>
type Step = Update.Step<Model, Message, Resources>

const unchanged: Step = (model) => ({ model })

const command =
	(...commands: NonNullable<Return["commands"]>): Step =>
	(model) => ({ model, commands })

const setModel =
	(f: (model: Model) => Model): Step =>
	(model) => ({ model: f(model) })

const foldToasts = Update.foldChild({
	update: (
		toasts: Toasts.Model,
		step: (toasts: Toasts.Model) => Update.Return<Toasts.Model, Toasts.Message>,
	) => step(toasts),
	read: (model: Model) => Option.some(model.toasts),
	write: (model, toasts) => modifyFields(model, { toasts: () => toasts }),
	toParentMessage: (message: Toasts.Message): Message => ({ _tag: "GotToastsMessage", message }),
})

const showToast = (toast: ToastRequest): Step => foldToasts((toasts) => Toasts.push(toasts, toast))

/** The toaster; a toast's action button reports what it asks for (the update toast's "Install & Restart"). */
const foldToastsWithAction = Update.foldChild({
	update: (toasts: Toasts.Model, message: Toasts.Message) => {
		const { action, ...result } = Toasts.update(toasts, message)
		return Update.withOutMessage(result, action)
	},
	read: (model: Model) => Option.some(model.toasts),
	write: (model, toasts) => modifyFields(model, { toasts: () => toasts }),
	toParentMessage: (message: Toasts.Message): Message => ({ _tag: "GotToastsMessage", message }),
	foldOutMessage: (action: ToastAction) =>
		Match.value(action).pipe(
			Match.withReturnType<Step>(),
			Match.when("InstallUpdate", () => stepUpdates(Updates.install)),
			Match.exhaustive,
		),
})

const showToastIf = (toast: ToastRequest | null | undefined): Step =>
	toast === null || toast === undefined ? unchanged : showToast(toast)

const toShell = (outMessage: PageOutMessage): Step => command(emit({ _tag: "Page", outMessage }))

const navigateTo = (route: AppRoute, options: { readonly replace?: boolean } = {}): Step =>
	toShell(PageOutMessage.RequestedNavigation({ route, replace: options.replace ?? false }))

/** After each step: the shell's frame reads the dock, bell, badge and page context from the report. */
const reported = (previous: Model, result: Return): Return => {
	const before = reportOf(previous)
	const after = reportOf(result.model)
	return sameReport(before, after)
		? result
		: { ...result, commands: [...(result.commands ?? []), emit({ _tag: "Report", report: after })] }
}

const sameReport = (a: ReturnType<typeof reportOf>, b: ReturnType<typeof reportOf>) =>
	a.isOverlayOpen === b.isOverlayOpen &&
	a.isSidebarCollapsed === b.isSidebarCollapsed &&
	a.bellCount === b.bellCount &&
	a.unreadNotificationCount === b.unreadNotificationCount &&
	a.isMarkingAllRead === b.isMarkingAllRead &&
	JSON.stringify(a.assistantContext) === JSON.stringify(b.assistantContext) &&
	JSON.stringify(a.badge) === JSON.stringify(b.badge)

// CHILDREN

const foldUpdates = Update.foldChild({
	update: (updates: Updates.Model, step: (updates: Updates.Model) => Updates.Return) => step(updates),
	read: (model: Model) => Option.some(model.desktopUpdate),
	write: (model, desktopUpdate) => modifyFields(model, { desktopUpdate: () => desktopUpdate }),
	toParentMessage: (message: Updates.Message): Message => ({ _tag: "GotUpdatesMessage", message }),
	foldOutMessage: Updates.OutMessage.match<Step>({ RequestedToast: ({ toast }) => showToast(toast) }),
})

/** An update step, its toast, and the pages that read `Shared.desktopUpdate`. */
const stepUpdates = (step: (updates: Updates.Model) => Updates.Return): Step =>
	Update.combine([foldUpdates(step), informPage])

const followModalOutMessage = (outMessage: ModalOutMessage): Step =>
	ModalOutMessage.match<Step>(outMessage, {
		Closed: () => unchanged,
		// Legacy `onSuccess` order: follow the link, then show the toast.
		Completed: ({ route, toast }) =>
			Update.combine([route === null ? unchanged : navigateTo(route), showToastIf(toast)]),
		RequestedToast: ({ toast }) => showToast(toast),
	})

/** A closing OutMessage has already dropped the modal slot; the host still follows it. */
const foldModal = Update.foldChild({
	update: (modal: Modal.Model, step: (modal: Modal.Model) => Modal.Transition) => {
		const transition = step(modal)
		return Update.withOutMessage(
			{ model: transition.model, commands: transition.commands ?? [] },
			Option.getOrUndefined(transition.outMessage),
		)
	},
	read: (model: Model) => Option.some(model.modal),
	write: (model, modal) => modifyFields(model, { modal: () => modal }),
	toParentMessage: (message: Modal.Message): Message => ({ _tag: "GotModalMessage", message }),
	foldOutMessage: followModalOutMessage,
})

/** What a modal reads: the shared state, plus the route (to leave a channel it deleted). */
const modalContextOf = (model: Model): Modal.ModalContext => ({
	...sharedOf(model),
	route: model.context.route,
})

/** A kind the root draws goes to it (`root/modals.ts`); the rest open here. */
const openModal =
	(request: Modal.ModalRequest): Step =>
	(model) =>
		isNativeModal(request._tag)
			? toShell(PageOutMessage.RequestedModal({ modal: request }))(model)
			: foldModal(model, (modal) => Modal.open(modal, request, modalContextOf(model)))

const foldPlatform = Update.foldChild({
	update: (
		platform: Platform.Model,
		step: (platform: Platform.Model) => Update.Return<Platform.Model, Platform.Message, Resources>,
	) => step(platform),
	read: (model: Model) => Option.some(model.platform),
	write: (model, platform) => modifyFields(model, { platform: () => platform }),
	toParentMessage: (message: Platform.Message): Message => ({ _tag: "GotPlatformMessage", message }),
})

/** Mod+J and the palette: the shell owns the AI panel (`root/assistant.ts`). */
const toggleAiPanel: Step = command(emit({ _tag: "Assistant", request: "Toggle" }))
const openAiPanel: Step = command(emit({ _tag: "Assistant", request: "Open" }))

/** The palette is the shell's (`root/palette.ts`): every way of opening it goes there. */
const openCommandPalette = (page: PalettePage): Step =>
	toShell(PageOutMessage.RequestedCommandPalette({ page }))

const foldShell = Update.foldChild({
	update: (shell: ShellModel, step: (shell: ShellModel) => Shell.ShellReturn) => step(shell),
	read: (model: Model) => Option.some(model.shell),
	write: (model, shell) => modifyFields(model, { shell: () => shell }),
	// Literal wrapper: the constructor would re-validate every sidebar row payload.
	toParentMessage: (message: ShellMessage): Message => ({ _tag: "GotShellMessage", message }),
	foldOutMessage: (outMessage: PageOutMessage) => handleOutMessage(outMessage),
})

/** The shell's menus and sidebar follow the route, organization, user, role and viewport. */
const informShell: Step = setModel((model) =>
	modifyFields(model, {
		shell: (shell) =>
			Shell.informContext(shell, {
				organizationId: model.context.organization?.id ?? null,
				currentUserId: model.context.currentUser?.id ?? null,
			}),
	}),
)

/** The page slot; its OutMessages are facts the host or the shell acts on. */
const foldPage = Update.foldChild({
	update: (page: PageSlot | null, step: (page: PageSlot | null) => PageTransition) => {
		const transition = step(page)
		return Update.withOutMessage(
			{ model: transition.slot, commands: transition.commands ?? [] },
			Option.getOrUndefined(transition.outMessage),
		)
	},
	read: (model: Model) => Option.some(model.page),
	write: (model, page) => modifyFields(model, { page: () => page }),
	toParentMessage: toPageMessage,
	foldOutMessage: (outMessage: PageOutMessage) => handleOutMessage(outMessage),
})

const informPage: Step = (model) => foldPage(model, (page) => informShared(page, sharedOf(model)))

/** Numbered, a page built for the route drops what its previous instance's Commands answer. */
const enteredRoute: Step = (model) => {
	const instance = model.pageInstances + 1
	return foldPage(modifyFields(model, { pageInstances: () => instance }), (page) =>
		enterRoute(page, model.context.route, sharedOf(model), instance),
	)
}

/** Discord's Alt+ArrowUp/Down: the sidebar's channel above or below the open one (Shift: unread only). */
const goToAdjacentChannel =
	(direction: ChannelNavigation.Direction, unreadOnly: boolean): Step =>
	(model) => {
		const orgSlug = orgSlugOf(model.context.route)
		const channelId: ChannelId | null = ChannelNavigation.adjacentChannel(
			model.shell.channelsSidebar,
			chatChannelIdOf(model.context.route),
			direction,
			unreadOnly,
			model.context.nowMs,
		)
		return orgSlug === undefined || channelId === null
			? { model }
			: navigateTo(AppRoute.ChatChannel({ orgSlug, channelId }))(model)
	}

/** Discord's Mod+Alt+ArrowUp/Down: the organization above or below in the switcher, wrapping. */
const goToAdjacentOrganization =
	(step: 1 | -1): Step =>
	(model) => {
		const organizations = model.shell.userOrganizations
		const currentId = model.context.organization?.id
		const index = organizations.findIndex((organization) => organization.id === currentId)
		const next =
			organizations.length < 2 || index === -1
				? undefined
				: organizations.at((index + step) % organizations.length)
		return next === undefined
			? { model }
			: navigateTo(organizationRoute(next, { isMobile: model.context.isMobile }))(model)
	}

/** Discord's Shift+Escape: every channel of this organization read, and the member's notifications. */
const markOrganizationRead: Step = (model) => {
	const organizationId = model.context.organization?.id
	return organizationId === undefined
		? { model }
		: foldShell(model, (shell) =>
				Shell.update(
					shell,
					ShellMessage.GotNotificationsMessage({
						message: Notifications.Message.PressedMarkOrganizationRead({ organizationId }),
					}),
				),
			)
}

/** Mod+Shift+D: docks the desktop sidebar to its nav rail and back (a phone's sheet is the root's). */
const toggleSidebar: Step = (model) =>
	foldShell(model, (shell) => Shell.update(shell, ShellMessage.ToggledSidebarCollapsed()))

/**
 * The `$orgSlug/layout.tsx` hotkeys whose work is here; the shell listens for every key and sends
 * these (it follows history and the inbox itself).
 */
const pressedHotkey = (actionId: LayoutHotkeyActionId): Step => hotkeySteps[actionId]()

/** One step per layout hotkey; the mapped type keeps it exhaustive. */
const hotkeySteps = {
	"commandPalette.open": () => openCommandPalette("home"),
	// Straight into message search, as the hotkey's description says (Discord, Slack).
	"search.open": () => openCommandPalette("search"),
	"channel.create": () => (model) =>
		can(sharedOf(model), "channel.create") ? openModal({ _tag: "NewChannel" })(model) : { model },
	"dm.create": () => openModal({ _tag: "CreateDm" }),
	"invite.email": () => openModal({ _tag: "EmailInvite" }),
	"channel.previous": () => goToAdjacentChannel("Previous", false),
	"channel.next": () => goToAdjacentChannel("Next", false),
	"channel.previousUnread": () => goToAdjacentChannel("Previous", true),
	"channel.nextUnread": () => goToAdjacentChannel("Next", true),
	// Unread counts are unread notifications (mentions, DMs, followed threads): the same channels.
	"mention.previous": () => goToAdjacentChannel("Previous", true),
	"mention.next": () => goToAdjacentChannel("Next", true),
	"organization.previous": () => goToAdjacentOrganization(-1),
	"organization.next": () => goToAdjacentOrganization(1),
	"organization.markRead": () => markOrganizationRead,
	"inbox.open": () => (model) => {
		const orgSlug = orgSlugOf(model.context.route)
		return orgSlug === undefined
			? { model }
			: navigateTo(AppRoute.NotificationsMentions({ orgSlug }))(model)
	},
	"shortcuts.open": () => openModal({ _tag: "KeyboardShortcuts" }),
	"sidebar.toggle": () => toggleSidebar,
	"aiPanel.toggle": () => toggleAiPanel,
	"history.back": () => toShell(PageOutMessage.RequestedHistory({ direction: "Back" })),
	"history.forward": () => toShell(PageOutMessage.RequestedHistory({ direction: "Forward" })),
} satisfies { readonly [K in LayoutHotkeyActionId]: () => Step }

/** The desktop app menu (legacy `TauriMenuListener`). */
const pressedDesktopMenuItem = (item: DesktopMenuItem): Step =>
	Match.value(item).pipe(
		Match.withReturnType<Step>(),
		Match.when("OpenSettings", () => (model) => {
			const orgSlug = orgSlugOf(model.context.route)
			return orgSlug === undefined
				? { model }
				: navigateTo(AppRoute.MySettingsDesktop({ orgSlug }))(model)
		}),
		Match.when("CheckForUpdates", () => stepUpdates(Updates.check)),
		Match.when("NewChannel", () => pressedHotkey("channel.create")),
		Match.when("Invite", () => pressedHotkey("invite.email")),
		Match.exhaustive,
	)

const receivedShellRequest = (request: ShellRequest): Step =>
	Match.valueTags(request, {
		PressedHotkey: ({ actionId }) => pressedHotkey(actionId),
		PressedDesktopMenuItem: ({ item }) => pressedDesktopMenuItem(item),
		PressedInstallUpdate: () => stepUpdates(Updates.install),
		RequestedToast: ({ toast }) => showToast(toast),
		PressedComposeDm: () => openModal({ _tag: "CreateDm" }),
		PressedMarkAllRead: () => (model: Model) =>
			foldShell(model, (shell) =>
				Shell.update(
					shell,
					ShellMessage.GotNotificationsMessage({
						message: Notifications.Message.ClickedMarkAllRead(),
					}),
				),
			),
		RequestedPageOut: ({ outMessage }) => handleOutMessage(outMessage),
		RequestedAiPanel: () => openAiPanel,
		PickedPresenceStatus: ({ status }) =>
			foldPlatform((platform) => Platform.pickPresenceStatus(platform, status)),
	})

/** Each request's toasts share an id, so each replaces the previous: loading, then success or error. */
const dmToastId = (key: string) => `create-dm:${key}`

const setCreatingDm = (key: string, isCreating: boolean): Step =>
	setModel((model) =>
		modifyFields(model, {
			creatingDms: (keys) => [
				...keys.filter((current) => current !== key),
				...(isCreating ? [key] : []),
			],
		}),
	)

/** Requests run side by side, each with its own toast; a repeat of one still in flight is ignored. */
const requestedDmCreation =
	({ organizationId, orgSlug, userId, name }: Omit<RequestedDmCreation, "_tag">): Step =>
	(model) => {
		const key = dmRequestKey(organizationId, userId)
		return model.creatingDms.includes(key)
			? { model }
			: Update.combine(model, [
					setCreatingDm(key, true),
					showToast({
						...loadingToast(`Starting conversation with ${name}...`),
						id: dmToastId(key),
					}),
					command(CreateDm({ organizationId, orgSlug, userId, name })),
				])
	}

/** Opens the new DM only while the user is still in its org; elsewhere the toast says it is ready. */
const succeededCreateDm =
	({
		organizationId,
		orgSlug,
		userId,
		channelId,
		name,
	}: Omit<Extract<Message, { readonly _tag: "SucceededCreateDm" }>, "_tag">): Step =>
	(model) => {
		const key = dmRequestKey(organizationId, userId)
		return Update.combine(model, [
			setCreatingDm(key, false),
			showToast({ ...successToast(`Started conversation with ${name}`), id: dmToastId(key) }),
			orgSlugOf(model.context.route) === orgSlug
				? navigateTo(AppRoute.ChatChannel({ orgSlug, channelId }))
				: unchanged,
		])
	}

/** A page or the sidebar reported a fact: overlays and DMs are the host's, the rest the shell's. */
const handleOutMessage = (outMessage: PageOutMessage): Step =>
	PageOutMessage.match<Step>(outMessage, {
		RequestedNavigation: () => toShell(outMessage),
		RequestedHref: () => toShell(outMessage),
		RequestedHistory: () => toShell(outMessage),
		RequestedToast: ({ toast }) => showToast(toast),
		RequestedModal: ({ modal }) => openModal(modal),
		RequestedCommandPalette: () => toShell(outMessage),
		RequestedSignOut: () => toShell(outMessage),
		RequestedDmCreation: requestedDmCreation,
		RequestedTheme: () => toShell(outMessage),
		RequestedSoundSettings: () => toShell(outMessage),
		RequestedKeybindings: () => toShell(outMessage),
		RequestedCurrentUserRefresh: () => toShell(outMessage),
		RequestedUpdateCheck: () => stepUpdates(Updates.check),
		RequestedUpdateInstall: () => stepUpdates(Updates.install),
	})

/** The shell's context changed: a new route enters the page again; the page and sidebar re-read it. */
const changedContext =
	(context: HostContext): Step =>
	(model) => {
		const previous = model.context
		const next = modifyFields(model, { context: () => context })
		const isNewRoute = previous.navigation !== context.navigation
		return Update.combine(next, [isNewRoute ? enteredRoute : informPage, informShell])
	}

// INIT

export const init = (context: HostContext): Return => {
	const model: Model = {
		context,
		page: null,
		pageInstances: 0,
		shell: Shell.init(),
		modal: Modal.initialModel,
		toasts: Toasts.init(),
		platform: Platform.init(),
		desktopUpdate: Updates.init(),
		creatingDms: [],
	}
	const result = Update.combine(model, [enteredRoute, informShell])
	return {
		...result,
		commands: [...(result.commands ?? []), emit({ _tag: "Report", report: reportOf(result.model) })],
	}
}

// UPDATE

const step = (model: Model, message: Message): Return =>
	Match.valueTags(message, {
		ChangedContext: ({ context }) => changedContext(context)(model),
		ReceivedShellRequest: ({ request }) => receivedShellRequest(request)(model),
		SucceededCreateDm: (succeeded) => succeededCreateDm(succeeded)(model),
		FailedCreateDm: ({ organizationId, userId, reason }) =>
			Update.combine(model, [
				setCreatingDm(dmRequestKey(organizationId, userId), false),
				showToast({
					...errorToastOf(
						failureMessage(reason, {
							AlreadyExists: {
								title: "You already have a conversation with them",
								description: "It will appear in your messages in a moment.",
							},
						}),
					),
					id: dmToastId(dmRequestKey(organizationId, userId)),
				}),
			]),
		CompletedEmit: () => ({ model }),
		ClickedLayoutTab: ({ route }) => navigateTo(route)(model),
		GotPageMessage: ({ message }) =>
			foldPage(model, (page) => updatePage(page, message, sharedOf(model))),
		GotShellMessage: ({ message }) => foldShell(model, (shell) => Shell.update(shell, message)),
		GotModalMessage: ({ message }) =>
			foldModal(model, (modal) => Modal.update(modal, message, modalContextOf(model))),
		GotToastsMessage: ({ message }) => foldToastsWithAction(model, message),
		GotPlatformMessage: ({ message }) =>
			foldPlatform(model, (platform) => Platform.update(platform, message)),
		GotUpdatesMessage: ({ message }) => stepUpdates((updates) => Updates.update(updates, message))(model),
	})

export const update = (model: Model, message: Message): Return => reported(model, step(model, message))
