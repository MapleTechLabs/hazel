import type { OrganizationId } from "@hazel/schema"
import { Clock, Effect, Match, Option, Schema } from "effect"
import { AsyncData, type Runtime, Update } from "foldkit"
import { UrlRequest } from "foldkit/navigation"
import { modifyFields } from "foldkit/struct"
import { toString as urlToString, type Url } from "foldkit/url"
import { commonMessage, type CommonReason, isRetryableReason } from "~/lib/error-messages"
import {
	ApplyTheme,
	CheckSession,
	DeliverNotifications,
	FetchCurrentUser,
	LoadExternal,
	NavigateInternal,
	Reload,
	ReplaceUrl,
	RetryCheckSession,
	RetryFetchCurrentUser,
	SaveSoundSettings,
	SaveThemePreference,
	SignOut,
	WarmAccessToken,
} from "./app/command"
import { Message } from "./app/message"
import {
	authOf,
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
import { toPageMessage } from "./app/view"
import { errorToast, errorToastOf } from "./data/actions"
import { loadSoundSettings, SoundSettings } from "./notification-sound"
import * as CommandPalette from "./overlay/command-palette"
import type { LayoutHotkeyActionId } from "./overlay/hotkeys"
import * as Modal from "./overlay/modal"
import { ModalOutMessage } from "./overlay/out-message"
import * as Toasts from "./overlay/toaster"
import type { ToastAction } from "./overlay/toasts"
import { can } from "./page/contract"
import { PageOutMessage } from "./page/out-message"
import { enterRoute, informShared, type PageSlot, type PageTransition, updatePage } from "./page/registry"
import * as Platform from "./platform"
import type { DesktopMenuItem } from "./platform/desktop-menu"
import * as Updates from "./platform/updates"
import { authRedirect, routeRedirect } from "./redirect"
import { AppRoute, hrefOf, isPublicRoute, orgSlugOf, urlToAppRoute } from "./route"
import type { CurrentUser, Member, Organization } from "./session"
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
	/** `sessionStartTimeAtom`: notifications from before this load never play; also the clock's first value. */
	sessionStartMs: Schema.Number,
	/** `useSidebar().isMobile` at load: the mobile layout renders from the first frame. */
	isMobile: Schema.Boolean,
	/** `useFeatureHint("create-channel")`. */
	isCreateChannelHintDismissed: Schema.Boolean,
})
export type Flags = typeof Flags.Type

export const flags: Effect.Effect<Flags> = Effect.all({
	themePreference: loadThemePreference,
	systemTheme: Effect.sync(resolveSystemTheme),
	soundSettings: loadSoundSettings,
	sessionStartMs: Clock.currentTimeMillis,
	isMobile: Effect.sync(() => globalThis.matchMedia?.(MOBILE_QUERY).matches ?? false),
	isCreateChannelHintDismissed: loadIsCreateChannelHintDismissed,
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

const enteredRoute: Step = (model) =>
	foldPage(model, (page) => enterRoute(page, model.route, sharedOf(model)))

/** `useAppHotkey` handlers in `$orgSlug/layout.tsx`. */
const pressedHotkey = (actionId: LayoutHotkeyActionId): Step =>
	Match.value(actionId).pipe(
		Match.withReturnType<Step>(),
		Match.when("commandPalette.open", () => openCommandPalette("home")),
		// Straight into message search, as the hotkey's description says (Discord, Slack).
		Match.when("search.open", () => openCommandPalette("search")),
		Match.when(
			"channel.create",
			() => (model) =>
				can(sharedOf(model), "channel.create") ? openModal({ _tag: "NewChannel" })(model) : { model },
		),
		Match.when("dm.create", () => openModal({ _tag: "CreateDm" })),
		Match.when("invite.email", () => openModal({ _tag: "EmailInvite" })),
		Match.exhaustive,
	)

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

/** A page or the shell reported a fact; the root owns navigation, the overlays and the session. */
const handleOutMessage = (outMessage: PageOutMessage): Step =>
	PageOutMessage.match<Step>(outMessage, {
		RequestedNavigation: ({ route, replace, toast }) =>
			Update.combine([showToastIf(toast), navigateTo(route, { replace })]),
		RequestedToast: ({ toast }) => showToast(toast),
		RequestedModal: ({ modal }) => openModal(modal),
		RequestedCommandPalette: ({ page }) => openCommandPalette(page),
		RequestedSignOut: () => command(SignOut()),
		RequestedTheme: ({ preference }) => requestedTheme(preference),
		RequestedSoundSettings: ({ settings }) =>
			Update.combine([
				setModel((model) => modifyFields(model, { soundSettings: () => settings })),
				command(SaveSoundSettings({ settings })),
				informPage,
			]),
		RequestedCurrentUserRefresh: ({ toast }) => Update.combine([showToastIf(toast), refreshCurrentUser]),
		RequestedUpdateCheck: () => stepUpdates(Updates.check),
		RequestedUpdateInstall: () => stepUpdates(Updates.install),
		// The shell owns its sheet: the root sends it the same Message as its header button.
		RequestedMobileSidebar: () => (model) =>
			foldShell(model, (shell) =>
				Shell.update(shell, ShellMessage.ToggledSidebar({ isOpen: true }), shellContextOf(model)),
			),
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
			session: Session.Loading({ isFetchingUser: isAppRoute }),
			org: OrgState.None(),
			isMobile: flags.isMobile,
			nowMs: flags.sessionStartMs,
			themePreference: flags.themePreference,
			systemTheme: flags.systemTheme,
			soundSettings: flags.soundSettings,
			sessionStartMs: flags.sessionStartMs,
			page: null,
			shell: Shell.init({ isCreateChannelHintDismissed: flags.isCreateChannelHintDismissed }),
			modal: Modal.initialModel,
			commandPalette: CommandPalette.init(),
			toasts: Toasts.init(),
			platform: Platform.init(),
			desktopUpdate: Updates.init(),
		},
		url,
	)
	return Update.combine(model, [
		appliedTheme,
		enteredRoute,
		informShell,
		redirect,
		isAppRoute ? command(CheckSession(), FetchCurrentUser(), WarmAccessToken()) : command(CheckSession()),
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
		CompletedReplaceUrl: () => ({ model }),
		CompletedLoadExternal: () => ({ model }),
		ChangedSystemTheme: ({ theme }) =>
			transitionTheme((current) => modifyFields(current, { systemTheme: () => theme }), false)(model),
		ChangedViewport: ({ isMobile }) =>
			Update.combine(modifyFields(model, { isMobile: () => isMobile }), [informPage, informShell]),
		CompletedApplyTheme: () => ({ model }),
		CompletedSaveThemePreference: () => ({ model }),
		FailedSaveThemePreference: () => savingFailed("Couldn't save your theme")(model),
		CompletedSaveSoundSettings: () => ({ model }),
		FailedSaveSoundSettings: () => savingFailed("Couldn't save your sound settings")(model),
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
		GotUpdatesMessage: ({ message }) => stepUpdates((updates) => Updates.update(updates, message))(model),
		PressedDesktopMenuItem: ({ item }) => pressedDesktopMenuItem(item)(model),
		GotPlatformMessage: ({ message }) =>
			foldPlatform(model, (platform) => Platform.update(platform, message)),
	})
