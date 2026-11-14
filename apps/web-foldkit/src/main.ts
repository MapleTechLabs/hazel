import type { ChannelId, OrganizationId } from "@hazel/schema"
import { Clock, Effect, Match, Option, Schema } from "effect"
import { AsyncData, type Runtime, Update } from "foldkit"
import { UrlRequest } from "foldkit/navigation"
import { modifyFields } from "foldkit/struct"
import { toString as urlToString, type Url } from "foldkit/url"
import { commonMessage, type CommonReason, failureMessage, isRetryableReason } from "~/lib/error-messages"
import {
	ApplyTheme,
	CheckSession,
	ClearNoteDrafts,
	CreateDm,
	DeliverNotifications,
	FetchCurrentUser,
	LoadExternal,
	NavigateHistory,
	NavigateInternal,
	Reload,
	ReplaceUrl,
	RetryCheckSession,
	RetryFetchCurrentUser,
	SaveKeybindings,
	SaveSoundSettings,
	SaveThemePreference,
	SignOut,
	WarmAccessToken,
	WarmSyncObjects,
} from "./app/command"
import { Message } from "./app/message"
import {
	authOf,
	dmRequestKey,
	MemberData,
	Model,
	OrgState,
	orgStateFor,
	resolvedThemeOf,
	Session,
	sharedOf,
	shellContextOf,
} from "./app/model"
import { MOBILE_QUERY } from "./app/subscription"
import { loadRememberedUser } from "./app/remembered-user"
import { toPageMessage } from "./app/view"
import { errorToast, errorToastOf, loadingToast, successToast } from "./data/actions"
import { loadSoundSettings, SoundSettings } from "./notification-sound"
import { loadKeybindingOverrides } from "./keybindings"
import { detectPlatform, Platform as KeyboardPlatform } from "~/lib/keybindings/key-combo"
import { Overrides } from "~/lib/keybindings/keymap"
import * as CommandPalette from "./overlay/command-palette"
import type { LayoutHotkeyActionId } from "./overlay/hotkeys"
import * as Modal from "./overlay/modal"
import { ModalOutMessage } from "./overlay/out-message"
import * as Toasts from "./overlay/toaster"
import type { ToastAction } from "./overlay/toasts"
import { can } from "./page/contract"
import { PageOutMessage, type RequestedDmCreation } from "./page/out-message"
import { enterRoute, informShared, type PageSlot, type PageTransition, updatePage } from "./page/registry"
import * as Platform from "./platform"
import type { DesktopMenuItem } from "./platform/desktop-menu"
import * as Updates from "./platform/updates"
import { authRedirect, routeRedirect } from "./redirect"
import {
	AppRoute,
	chatChannelIdOf,
	hrefOf,
	isPublicRoute,
	organizationRoute,
	orgSlugOf,
	urlToAppRoute,
} from "./route"
import * as Notifications from "./shell/notifications"
import * as ChannelNavigation from "./shell/channels-sidebar/navigation"
import { CurrentUser, type Member, type Organization } from "./session"
import type { Resources } from "./rpc"
import { loadIsCreateChannelHintDismissed } from "./shell/channels-sidebar"
import { Message as ShellMessage, type Model as ShellModel } from "./shell/model"
import * as Shell from "./shell/update"
import {
	loadThemePreference,
	ResolvedTheme,
	resolveSystemTheme,
	type ThemeCustomization,
	ThemePreference,
} from "./theme"

export { Message } from "./app/message"
export { Model } from "./app/model"
export { subscriptions } from "./app/subscription"
export { view } from "./app/view"

/** Read before the first render, so a stored theme, the viewport or a dismissed hint never flash. */
export const Flags = Schema.Struct({
	themePreference: ThemePreference,
	systemTheme: ResolvedTheme,
	soundSettings: SoundSettings,
	keybindingOverrides: Overrides,
	keyboardPlatform: KeyboardPlatform,
	/** `sessionStartTimeAtom`: notifications from before this load never play; also the clock's first value. */
	sessionStartMs: Schema.Number,
	/** `useSidebar().isMobile` at load: the mobile layout renders from the first frame. */
	isMobile: Schema.Boolean,
	/** `useFeatureHint("create-channel")`. */
	isCreateChannelHintDismissed: Schema.Boolean,
	/** The last session's user (`app/remembered-user.ts`): an app route starts signed in as them. */
	rememberedUser: Schema.NullOr(CurrentUser),
})
export type Flags = typeof Flags.Type

export const flags: Effect.Effect<Flags> = Effect.all({
	themePreference: loadThemePreference,
	systemTheme: Effect.sync(resolveSystemTheme),
	soundSettings: loadSoundSettings,
	keybindingOverrides: loadKeybindingOverrides,
	keyboardPlatform: Effect.sync(detectPlatform),
	sessionStartMs: Clock.currentTimeMillis,
	isMobile: Effect.sync(() => globalThis.matchMedia?.(MOBILE_QUERY).matches ?? false),
	isCreateChannelHintDismissed: loadIsCreateChannelHintDismissed,
	rememberedUser: loadRememberedUser,
})

/** Production builds skip the dev-only routes. Read once here, never inside `update`. */
const IS_PROD = import.meta.env.PROD

/** Automatic retries of a session check or `user.me` before the error screen waits for the user. */
export const MAX_AUTO_RETRIES = 3

type Return = Update.Return<Model, Message, Resources>
type Step = Update.Step<Model, Message, Resources>

const unchanged: Step = (model) => ({ model })

const command =
	(...commands: NonNullable<Return["commands"]>): Step =>
	(model) => ({ model, commands })

const setModel =
	(f: (model: Model) => Model): Step =>
	(model) => ({ model: f(model) })

// CHILDREN

/** Each child folds through one lens; the input is the child entry point to run (open, push, update...). */

const foldToasts = Update.foldChild({
	update: (
		toasts: Toasts.Model,
		step: (toasts: Toasts.Model) => Update.Return<Toasts.Model, Toasts.Message>,
	) => step(toasts),
	read: (model: Model) => Option.some(model.toasts),
	write: (model, toasts) => modifyFields(model, { toasts: () => toasts }),
	toParentMessage: (message: Toasts.Message) => Message.GotToastsMessage({ message }),
})

const showToast = (toast: Toasts.ToastRequest): Step => foldToasts((toasts) => Toasts.push(toasts, toast))

const showToastIf = (toast: Toasts.ToastRequest | null | undefined): Step =>
	toast === null || toast === undefined ? unchanged : showToast(toast)

const navigateTo = (route: AppRoute, options: { readonly replace?: boolean } = {}): Step =>
	command(options.replace ? ReplaceUrl({ url: hrefOf(route) }) : NavigateInternal({ url: hrefOf(route) }))

const foldUpdates = Update.foldChild({
	update: (updates: Updates.Model, step: (updates: Updates.Model) => Updates.Return) => step(updates),
	read: (model: Model) => Option.some(model.desktopUpdate),
	write: (model, desktopUpdate) => modifyFields(model, { desktopUpdate: () => desktopUpdate }),
	toParentMessage: (message: Updates.Message) => Message.GotUpdatesMessage({ message }),
	foldOutMessage: Updates.OutMessage.match<Step>({ RequestedToast: ({ toast }) => showToast(toast) }),
})

/** An update step, its toast, and the pages that read `Shared.desktopUpdate`. */
const stepUpdates = (step: (updates: Updates.Model) => Updates.Return): Step =>
	Update.combine([foldUpdates(step), informPage])

/** The toaster; a toast's action button reports what it asks for (the update toast's "Install & Restart"). */
const foldToastsWithAction = Update.foldChild({
	update: (toasts: Toasts.Model, message: Toasts.Message) => {
		const { action, ...result } = Toasts.update(toasts, message)
		return Update.withOutMessage(result, action)
	},
	read: (model: Model) => Option.some(model.toasts),
	write: (model, toasts) => modifyFields(model, { toasts: () => toasts }),
	toParentMessage: (message: Toasts.Message) => Message.GotToastsMessage({ message }),
	foldOutMessage: (action: ToastAction) =>
		Match.value(action).pipe(
			Match.withReturnType<Step>(),
			Match.when("InstallUpdate", () => stepUpdates(Updates.install)),
			Match.exhaustive,
		),
})

const followModalOutMessage = (outMessage: ModalOutMessage): Step =>
	ModalOutMessage.match<Step>(outMessage, {
		Closed: () => unchanged,
		// Legacy `onSuccess` order: follow the link, then show the toast.
		Completed: ({ route, toast }) =>
			Update.combine([route === null ? unchanged : navigateTo(route), showToastIf(toast)]),
		RequestedToast: ({ toast }) => showToast(toast),
	})

/** A closing OutMessage has already dropped the modal slot; the root still follows it. */
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
	toParentMessage: (message: Modal.Message) => Message.GotModalMessage({ message }),
	foldOutMessage: followModalOutMessage,
})

/** What a modal reads: the shared state, plus the route (to leave a channel it deleted). */
const modalContextOf = (model: Model): Modal.ModalContext => ({ ...sharedOf(model), route: model.route })

const openModal =
	(request: Modal.ModalRequest): Step =>
	(model) =>
		foldModal(model, (modal) => Modal.open(modal, request, modalContextOf(model)))

const foldPlatform = Update.foldChild({
	update: (
		platform: Platform.Model,
		step: (platform: Platform.Model) => Update.Return<Platform.Model, Platform.Message, Resources>,
	) => step(platform),
	read: (model: Model) => Option.some(model.platform),
	write: (model, platform) => modifyFields(model, { platform: () => platform }),
	toParentMessage: (message: Platform.Message) => Message.GotPlatformMessage({ message }),
})

const foldCommandPalette = Update.foldChild({
	update: (
		palette: CommandPalette.Model,
		step: (palette: CommandPalette.Model) => ReturnType<typeof CommandPalette.update>,
	) => step(palette),
	read: (model: Model) => Option.some(model.commandPalette),
	write: (model, commandPalette) => modifyFields(model, { commandPalette: () => commandPalette }),
	toParentMessage: (message: CommandPalette.Message) => Message.GotCommandPaletteMessage({ message }),
	foldOutMessage: (outMessage: CommandPalette.OutMessage) =>
		CommandPalette.OutMessage.match<Step>(outMessage, {
			// The palette's links can carry a search (`?messageId=`), so they stay URLs.
			Completed: ({ href, toast }) =>
				Update.combine([
					href === null ? unchanged : command(NavigateInternal({ url: href })),
					showToastIf(toast),
				]),
			RequestedModal: ({ modal }) => openModal(modal),
			RequestedToast: ({ toast }) => showToast(toast),
			RequestedTheme: ({ preference }) => requestedTheme(preference),
			RequestedPresenceStatus: ({ status }) =>
				foldPlatform((platform) => Platform.pickPresenceStatus(platform, status)),
		}),
})

const openCommandPalette =
	(page: CommandPalette.Page): Step =>
	(model) =>
		foldCommandPalette(model, (palette) => CommandPalette.open(palette, page, sharedOf(model)))

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
	modifyFields(model, { shell: (shell) => Shell.informContext(shell, shellContextOf(model)) }),
)

/** The page slot; its OutMessages are facts the root acts on (navigation, overlays, session). */
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
		enterRoute(page, model.route, sharedOf(model), instance),
	)
}

/** Discord's Alt+ArrowUp/Down: the sidebar's channel above or below the open one (Shift: unread only). */
const goToAdjacentChannel =
	(direction: ChannelNavigation.Direction, unreadOnly: boolean): Step =>
	(model) => {
		const orgSlug = orgSlugOf(model.route)
		const channelId = ChannelNavigation.adjacentChannel(
			model.shell.channelsSidebar,
			chatChannelIdOf(model.route),
			direction,
			unreadOnly,
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
		const currentId = sharedOf(model).organization?.id
		const index = organizations.findIndex((organization) => organization.id === currentId)
		const next =
			organizations.length < 2 || index === -1
				? undefined
				: organizations.at((index + step) % organizations.length)
		return next === undefined ? { model } : navigateTo(organizationRoute(next))(model)
	}

/** Discord's Shift+Escape: every unread notification of this organization's member marked read. */
const markOrganizationRead: Step = (model) =>
	foldShell(model, (shell) =>
		Shell.update(
			shell,
			ShellMessage.GotNotificationsMessage({ message: Notifications.Message.ClickedMarkAllRead() }),
			shellContextOf(model),
		),
	)

/** Mod+I: the notifications inbox. */
const openInbox: Step = (model) => {
	const orgSlug = orgSlugOf(model.route)
	return orgSlug === undefined ? { model } : navigateTo(AppRoute.NotificationsAll({ orgSlug }))(model)
}

/** Mod+Shift+D: docks the desktop sidebar to its nav rail and back; on mobile, opens or closes the sheet. */
const toggleSidebar: Step = (model) =>
	model.isMobile
		? foldShell(model, (shell) =>
				Shell.update(
					shell,
					ShellMessage.ToggledSidebar({ isOpen: !shell.isSidebarOpen }),
					shellContextOf(model),
				),
			)
		: foldShell(model, (shell) =>
				Shell.update(shell, ShellMessage.ToggledSidebarCollapsed(), shellContextOf(model)),
			)

/** `useAppHotkey` handlers in `$orgSlug/layout.tsx`. */
const pressedHotkey = (actionId: LayoutHotkeyActionId): Step => hotkeySteps[actionId]()

/** One step per layout hotkey; the mapped type keeps it exhaustive (a `Match` chain outgrew `pipe`). */
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
	"inbox.open": () => openInbox,
	"shortcuts.open": () => openModal({ _tag: "KeyboardShortcuts" }),
	"sidebar.toggle": () => toggleSidebar,
	"history.back": () => command(NavigateHistory({ direction: "Back" })),
	"history.forward": () => command(NavigateHistory({ direction: "Forward" })),
} satisfies { readonly [K in LayoutHotkeyActionId]: () => Step }

/** The desktop app menu (legacy `TauriMenuListener`). */
const pressedDesktopMenuItem = (item: DesktopMenuItem): Step =>
	Match.value(item).pipe(
		Match.withReturnType<Step>(),
		Match.when("OpenSettings", () => (model) => {
			const orgSlug = orgSlugOf(model.route)
			return orgSlug === undefined
				? { model }
				: navigateTo(AppRoute.MySettingsDesktop({ orgSlug }))(model)
		}),
		Match.when("CheckForUpdates", () => stepUpdates(Updates.check)),
		Match.when("NewChannel", () => pressedHotkey("channel.create")),
		Match.when("Invite", () => pressedHotkey("invite.email")),
		Match.exhaustive,
	)

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
			orgSlugOf(model.route) === orgSlug
				? navigateTo(AppRoute.ChatChannel({ orgSlug, channelId }))
				: unchanged,
		])
	}

/** A page or the shell reported a fact; the root owns navigation, the overlays and the session. */
const handleOutMessage = (outMessage: PageOutMessage): Step =>
	PageOutMessage.match<Step>(outMessage, {
		RequestedNavigation: ({ route, replace, toast }) =>
			Update.combine([showToastIf(toast), navigateTo(route, { replace })]),
		RequestedToast: ({ toast }) => showToast(toast),
		RequestedModal: ({ modal }) => openModal(modal),
		RequestedCommandPalette: ({ page }) => openCommandPalette(page),
		RequestedSignOut: () => command(SignOut()),
		RequestedDmCreation: requestedDmCreation,
		RequestedTheme: ({ preference }) => requestedTheme(preference),
		RequestedSoundSettings: ({ settings }) =>
			Update.combine([
				setModel((model) => modifyFields(model, { soundSettings: () => settings })),
				command(SaveSoundSettings({ settings })),
				informPage,
			]),
		RequestedKeybindings: ({ overrides }) =>
			Update.combine([
				setModel((model) => modifyFields(model, { keybindingOverrides: () => overrides })),
				command(SaveKeybindings({ overrides })),
				informPage,
			]),
		RequestedCurrentUserRefresh: ({ toast }) => Update.combine([showToastIf(toast), refreshCurrentUser]),
		RequestedUpdateCheck: () => stepUpdates(Updates.check),
		RequestedUpdateInstall: () => stepUpdates(Updates.install),
	})

// SESSION

/** `beforeLoad` redirects and the signed-out gate, re-checked whenever the route or session changes. */
const redirect: Step = (model) =>
	Option.match(
		Option.orElse(routeRedirect(model.route, { isProd: IS_PROD }), () =>
			authRedirect(model.route, authOf(model.session), model.currentUrl),
		),
		{ onNone: () => ({ model }), onSome: (route) => navigateTo(route, { replace: true })(model) },
	)

/** Everything that reads the session: the page, the shell and the signed-out gate. */
const sessionChanged: Step = Update.combine([informPage, informShell, redirect])

/** `useAtomRefresh(userAtom)`: `user.me` again, keeping the user on screen while it runs. */
const refreshCurrentUser: Step = (model) =>
	model.session._tag !== "SignedIn"
		? { model }
		: Option.match(AsyncData.revalidateOrLoad(model.session.user), {
				onNone: () => ({ model }),
				onSome: (user) => ({
					model: modifyFields(model, { session: () => Session.SignedIn({ user, retries: 0 }) }),
					commands: [FetchCurrentUser()],
				}),
			})

const signedInSession = Session.SignedIn({ user: AsyncData.Loading(), retries: 0 })

const changedAuth =
	(auth: "SignedIn" | "SignedOut"): Step =>
	(model) => {
		if (auth === "SignedOut")
			return model.session._tag === "SignedOut"
				? { model }
				: sessionChanged(modifyFields(model, { session: () => Session.SignedOut() }))
		// A session check that confirms the session changes nothing; a new one loads its user,
		// unless the boot `user.me` is already on its way.
		if (model.session._tag === "SignedIn") return { model }
		const isFetchingUser = model.session._tag === "Loading" && model.session.isFetchingUser
		return Update.combine(modifyFields(model, { session: () => signedInSession }), [
			sessionChanged,
			isFetchingUser ? unchanged : command(FetchCurrentUser()),
			// Signed out and in again without a reload: maybe someone else.
			model.session._tag === "SignedOut" ? command(ClearNoteDrafts()) : unchanged,
		])
	}

/** The API did not answer the session check. A signed-in session stays: only the boot check can stall. */
const failedCheckSession =
	(reason: CommonReason): Step =>
	(model) => {
		if (model.session._tag === "SignedIn" || model.session._tag === "SignedOut") return { model }
		const retries = model.session._tag === "Unreachable" ? model.session.retries : 0
		const isAutoRetried = retries < MAX_AUTO_RETRIES
		return {
			model: modifyFields(model, {
				session: () => Session.Unreachable({ reason, retries: retries + 1 }),
			}),
			commands: isAutoRetried ? [RetryCheckSession()] : [],
		}
	}

/** `user.me` answered. Before the session check does, the answer settles the session too. */
const succeededFetchCurrentUser =
	(user: CurrentUser): Step =>
	(model) =>
		model.session._tag === "SignedOut"
			? { model }
			: sessionChanged(
					modifyFields(model, {
						session: () =>
							Session.SignedIn({ user: AsyncData.Success({ data: user }), retries: 0 }),
					}),
				)

/** `user.me` failed. A transient failure is retried a few times; after that, or an ended session, it shows. */
const failedFetchCurrentUser =
	(reason: CommonReason): Step =>
	(model) => {
		// The boot `user.me` failed before the session check answered: that check fetches again if signed in.
		if (model.session._tag === "Loading")
			return {
				model: modifyFields(model, { session: () => Session.Loading({ isFetchingUser: false }) }),
			}
		if (model.session._tag !== "SignedIn") return { model }
		const { user, retries } = model.session
		const hasUser = AsyncData.hasData(user)
		if (!hasUser && isRetryableReason(reason) && retries < MAX_AUTO_RETRIES)
			return {
				model: modifyFields(model, {
					session: () => Session.SignedIn({ user, retries: retries + 1 }),
				}),
				commands: [RetryFetchCurrentUser()],
			}
		const failed = Session.SignedIn({
			user: Option.match(AsyncData.getData(user), {
				onNone: () => AsyncData.Failure({ error: reason }),
				onSome: (data) => AsyncData.Stale({ error: reason, data }),
			}),
			retries,
		})
		// An ended session re-reads it: if it is gone, ChangedAuth sends the browser to sign-in.
		return Update.combine(modifyFields(model, { session: () => failed }), [
			sessionChanged,
			reason === "SignedOut" ? command(CheckSession()) : unchanged,
		])
	}

// ORGANIZATION

const updatedOrganization =
	(orgSlug: string, organization: Organization | null): Step =>
	(model) => {
		const current = model.org
		if (current._tag === "None" || current.slug !== orgSlug) return { model }
		const next: OrgState =
			organization === null
				? OrgState.NotFound({ slug: orgSlug })
				: OrgState.Loaded({
						slug: orgSlug,
						organization,
						// The role belongs to one organization; another one's must not show until its own arrives.
						member:
							current._tag === "Loaded" && current.organization.id === organization.id
								? current.member
								: MemberData.Loading(),
					})
		return Update.combine(modifyFields(model, { org: () => next }), [informPage, informShell])
	}

/** The user's row in the loaded organization; a row for another organization is stale and ignored. */
const updatedMember =
	(organizationId: OrganizationId, member: Member | null): Step =>
	(model) => {
		const current = model.org
		if (current._tag !== "Loaded" || current.organization.id !== organizationId) return { model }
		return Update.combine(
			modifyFields(model, {
				org: () => OrgState.Loaded({ ...current, member: MemberData.Success({ data: member }) }),
			}),
			[informPage, informShell],
		)
	}

// URL

const withUrl = (model: Model, url: Url): Model => {
	const route = urlToAppRoute(url)
	return modifyFields(model, {
		route: () => route,
		// Foldkit's `Url.search` holds the query without its `?`.
		currentUrl: () =>
			Option.match(url.search, {
				onNone: () => url.pathname,
				onSome: (search) => `${url.pathname}?${search}`,
			}),
		org: (org) => orgStateFor(org, route),
	})
}

// THEME

const isSameCustomization = (first: ThemeCustomization, second: ThemeCustomization) =>
	first.primary === second.primary &&
	first.grayPalette === second.grayPalette &&
	first.radius === second.radius

/**
 * The legacy theme atoms' effects after a change: re-apply when the resolved mode or the
 * customization changed, persist a user's choice, and tell the page when `Shared.theme` moved.
 */
const transitionTheme =
	(next: (model: Model) => Model, shouldPersist: boolean): Step =>
	(previous) => {
		const model = next(previous)
		const resolved = resolvedThemeOf(model)
		const { mode, customization } = model.themePreference
		const isApplied =
			resolved !== resolvedThemeOf(previous) ||
			!isSameCustomization(customization, previous.themePreference.customization)
		const commands = [
			...(isApplied ? [ApplyTheme({ resolved, customization })] : []),
			...(shouldPersist ? [SaveThemePreference({ preference: model.themePreference })] : []),
		]
		return Update.combine(model, [
			command(...commands),
			isApplied || mode !== previous.themePreference.mode ? informPage : unchanged,
		])
	}

/** `RequestedTheme` from a page or the palette: the user's choice, applied and persisted. */
const requestedTheme = (preference: ThemePreference): Step =>
	transitionTheme((model) => modifyFields(model, { themePreference: () => preference }), true)

export const requestTheme = (model: Model, preference: ThemePreference): Return =>
	requestedTheme(preference)(model)

const appliedTheme: Step = (model) =>
	command(
		ApplyTheme({ resolved: resolvedThemeOf(model), customization: model.themePreference.customization }),
	)(model)

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message, Flags, Resources> = (flags, url) => {
	const route = urlToAppRoute(url)
	// An app route needs the user: ask for it, and the sync token, beside the session check.
	const isAppRoute = route._tag !== "NotFound" && !isPublicRoute(route)
	const model: Model = withUrl(
		{
			route,
			currentUrl: "",
			// The remembered user shows at once, from the local cache; the session check and
			// `user.me` below still decide whether the session is theirs.
			session:
				isAppRoute && flags.rememberedUser !== null
					? Session.SignedIn({
							user: AsyncData.Refreshing({ data: flags.rememberedUser }),
							retries: 0,
						})
					: Session.Loading({ isFetchingUser: isAppRoute }),
			org: OrgState.None(),
			isMobile: flags.isMobile,
			nowMs: flags.sessionStartMs,
			themePreference: flags.themePreference,
			systemTheme: flags.systemTheme,
			soundSettings: flags.soundSettings,
			keybindingOverrides: flags.keybindingOverrides,
			keyboardPlatform: flags.keyboardPlatform,
			sessionStartMs: flags.sessionStartMs,
			page: null,
			pageInstances: 0,
			shell: Shell.init({ isCreateChannelHintDismissed: flags.isCreateChannelHintDismissed }),
			modal: Modal.initialModel,
			commandPalette: CommandPalette.init(),
			toasts: Toasts.init(),
			platform: Platform.init(),
			desktopUpdate: Updates.init(),
			creatingDms: [],
		},
		url,
	)
	return Update.combine(model, [
		appliedTheme,
		enteredRoute,
		informShell,
		redirect,
		isAppRoute
			? command(
					CheckSession(),
					FetchCurrentUser(),
					WarmAccessToken(),
					WarmSyncObjects({
						userId: flags.rememberedUser?.id ?? null,
						channelId: chatChannelIdOf(route),
					}),
				)
			: command(CheckSession()),
	])
}

// UPDATE

const savingFailed = (title: string) =>
	showToast(errorToast(title, "It applies for now, but won't be remembered next time."))

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		ClickedLink: ({ request }) =>
			UrlRequest.match<Return>(request, {
				Internal: ({ url }) => ({ model, commands: [NavigateInternal({ url: urlToString(url) })] }),
				External: ({ href }) => ({ model, commands: [LoadExternal({ href })] }),
			}),
		ChangedUrl: ({ url }) => Update.combine(withUrl(model, url), [enteredRoute, informShell, redirect]),
		CompletedNavigateInternal: () => ({ model }),
		CompletedNavigateHistory: () => ({ model }),
		CompletedReplaceUrl: () => ({ model }),
		CompletedLoadExternal: () => ({ model }),
		CompletedClearNoteDrafts: () => ({ model }),
		ChangedSystemTheme: ({ theme }) =>
			transitionTheme((current) => modifyFields(current, { systemTheme: () => theme }), false)(model),
		ChangedViewport: ({ isMobile }) =>
			Update.combine(modifyFields(model, { isMobile: () => isMobile }), [informPage, informShell]),
		CompletedApplyTheme: () => ({ model }),
		CompletedSaveThemePreference: () => ({ model }),
		FailedSaveThemePreference: () => savingFailed("Couldn't save your theme")(model),
		CompletedSaveSoundSettings: () => ({ model }),
		FailedSaveSoundSettings: () => savingFailed("Couldn't save your sound settings")(model),
		CompletedSaveKeybindings: () => ({ model }),
		FailedSaveKeybindings: () => savingFailed("Couldn't save your keybinds")(model),
		UpdatedRecentNotifications: ({ ids }) => ({
			model,
			commands: ids.length === 0 ? [] : [DeliverNotifications({ ids })],
		}),
		CompletedDeliverNotifications: () => ({ model }),
		ChangedAuth: ({ auth }) => changedAuth(auth)(model),
		FailedCheckSession: ({ reason }) => failedCheckSession(reason)(model),
		PressedRetrySession: () =>
			model.session._tag === "Unreachable"
				? {
						model: modifyFields(model, {
							session: () => Session.Loading({ isFetchingUser: false }),
						}),
						commands: [CheckSession()],
					}
				: { model },
		RejectedSession: () => ({ model, commands: [CheckSession()] }),
		SucceededFetchCurrentUser: ({ user }) => succeededFetchCurrentUser(user)(model),
		FailedFetchCurrentUser: ({ reason }) => failedFetchCurrentUser(reason)(model),
		PressedRetryCurrentUser: () => refreshCurrentUser(model),
		CompletedWarmAccessToken: () => ({ model }),
		CompletedWarmSyncObjects: () => ({ model }),
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
		// A full load of `/`: every collection, token and subscription starts over, signed out.
		SucceededSignOut: () => ({ model, commands: [LoadExternal({ href: hrefOf(AppRoute.Root()) })] }),
		FailedSignOut: ({ reason }) =>
			showToast(
				errorToastOf({ title: "Failed to sign out", description: commonMessage(reason).description }),
			)(model),
		UpdatedOrganization: ({ orgSlug, organization }) => updatedOrganization(orgSlug, organization)(model),
		// Only a slug still loading counts: data already on screen stays when its sync hiccups.
		StalledOrganization: ({ orgSlug }) =>
			model.org._tag === "Loading" && model.org.slug === orgSlug && !model.org.isStalled
				? {
						model: modifyFields(model, {
							org: () => OrgState.Loading({ slug: orgSlug, isStalled: true }),
						}),
					}
				: { model },
		PressedReload: () => ({ model, commands: [Reload()] }),
		CompletedReload: () => ({ model }),
		UpdatedMember: ({ organizationId, member }) => updatedMember(organizationId, member)(model),
		TickedClock: ({ nowMs }) => ({ model: modifyFields(model, { nowMs: () => nowMs }) }),
		ClickedLayoutTab: ({ route }) => navigateTo(route)(model),
		GotPageMessage: ({ message }) =>
			foldPage(model, (page) => updatePage(page, message, sharedOf(model))),
		GotShellMessage: ({ message }) =>
			foldShell(model, (shell) => Shell.update(shell, message, shellContextOf(model))),
		GotModalMessage: ({ message }) =>
			foldModal(model, (modal) => Modal.update(modal, message, modalContextOf(model))),
		GotCommandPaletteMessage: ({ message }) =>
			foldCommandPalette(model, (palette) => CommandPalette.update(palette, message, sharedOf(model))),
		PressedHotkey: ({ actionId }) => pressedHotkey(actionId)(model),
		GotToastsMessage: ({ message }) => foldToastsWithAction(model, message),
		ReceivedBackgroundToast: ({ toast }) => showToast(toast)(model),
		GotUpdatesMessage: ({ message }) => stepUpdates((updates) => Updates.update(updates, message))(model),
		PressedDesktopMenuItem: ({ item }) => pressedDesktopMenuItem(item)(model),
		GotPlatformMessage: ({ message }) =>
			foldPlatform(model, (platform) => Platform.update(platform, message)),
	})
