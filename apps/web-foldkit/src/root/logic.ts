// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The shell's decisions as pure functions of its Model: the session, the organization, the route's
 * redirects, the theme and what the Foldkit host asks for. Ported from today's root update
 * (`git show cd159551c:apps/web-foldkit/src/main.ts`) with the same rules; `app.ts` runs them.
 */
import { Command, Component, Router } from "@effect/ui"
import { AppRequest, PalettePage } from "@hazel/shared-screens/app/requests"
import type { NotificationId, OrganizationId } from "@hazel/schema"
import { Effect, Match, Option, Schema } from "effect"
import { AsyncData } from "foldkit"
import { commonMessage, type CommonReason, isRetryableReason } from "~/lib/error-messages"
import { Platform as KeyboardPlatform } from "~/lib/keybindings/key-combo"
import { Overrides } from "~/lib/keybindings/keymap"
import { appKeymap } from "~/lib/keybindings/app-keymap"
import { type HostContext, type HostOut, type HostReport } from "../app/context"
import { ShellRequest } from "../app/message"
import { errorToast, errorToastOf } from "../data/actions"
import { ModalRequest } from "../overlay/modal/requests"
import type { LayoutHotkeyActionId } from "../overlay/hotkeys"
import type { ToastRequest } from "../overlay/toasts"
import { PageOutMessage } from "../page/out-message"
import type { DesktopMenuItem } from "../platform/desktop-menu"
import { authRedirect, routeRedirect } from "../redirect"
import { AppRoute, chatChannelIdOf, hrefOf, isPublicRoute } from "../route"
import { CurrentUser, type Member, type Organization } from "../session"
import { SoundSettings } from "../notification-sound"
import { ResolvedTheme, resolveTheme, type ThemeCustomization, ThemePreference } from "../theme"
import * as Commands from "./commands"
import { publish } from "./bus"
import type { AppMessage } from "./message"
import { AppRoutes, routeOfHref } from "./routes"
import {
	authOf,
	currentUserOfSession,
	loadedOrgOf,
	MemberData,
	memberOfOrg,
	OrgState,
	orgStateFor,
	Session,
} from "./state"

// MODEL

const HostReportSchema = Schema.declare((_: unknown): _ is HostReport => true)

export const AppModel = Schema.Struct({
	route: AppRoute,
	/** Counts route changes: the Foldkit host enters the route again on each (`HostContext.navigation`). */
	navigation: Schema.Int,
	/** `pathname + search`, for `redirect_url`. */
	currentUrl: Schema.String,
	session: Session,
	org: OrgState,
	/** `useSidebar().isMobile`: the `(max-width: 767px)` viewport. */
	isMobile: Schema.Boolean,
	/** Wall clock for presence and status expiry, ticking while the signed-in shell shows. */
	nowMs: Schema.Finite,
	themePreference: ThemePreference,
	systemTheme: ResolvedTheme,
	soundSettings: SoundSettings,
	keybindingOverrides: Overrides,
	keyboardPlatform: KeyboardPlatform,
	/** When this app load started, for the notification sinks. */
	sessionStartMs: Schema.Finite,
	/** The user's unread notifications in every organization: the badges' mention count. */
	unreadMentionIds: Schema.Array(Schema.String),
	/** The Foldkit host's state the frame shows (the dock, the bell, the badge, the AI panel). */
	report: Schema.NullOr(HostReportSchema),
	/** The last command palette: the page it opened on, a count that mounts a fresh one per open, and whether it is still open. */
	palette: Schema.NullOr(Schema.Struct({ page: PalettePage, opened: Schema.Int, isOpen: Schema.Boolean })),
})
export type AppModel = typeof AppModel.Type

/** The services the shell's Commands run on: its own, and the Router's navigation. */
type CommandServices =
	| Commands.CheckSession
	| Commands.FetchCurrentUser
	| Commands.SignOut
	| Router.Push
	| Router.Replace
	| Router.Back
	| Router.Forward

export type AppCommand = Command.Command<AppMessage | Component.Noop, CommandServices>

// A step's result: the next Model and the Commands to run.
export interface Next {
	readonly model: AppModel
	readonly commands: ReadonlyArray<AppCommand>
}
type Step = (model: AppModel) => Next

/** No Commands: one shared empty list. */
const none: ReadonlyArray<AppCommand> = []

const unchanged: Step = (model) => ({ model, commands: none })
const command =
	(...commands: ReadonlyArray<AppCommand>): Step =>
	(model) => ({ model, commands })
const setModel =
	(f: (model: AppModel) => AppModel): Step =>
	(model) => ({ model: f(model), commands: none })

/** Runs the steps in order, each from the Model the one before returned. */
export const combine =
	(steps: ReadonlyArray<Step>): Step =>
	(model) =>
		steps.reduce<Next>(
			(next, step) => {
				const result = step(next.model)
				return { model: result.model, commands: [...next.commands, ...result.commands] }
			},
			{ model, commands: none },
		)

/** A command that publishes to the Foldkit host: the work behind it is still there. */
const ToHost = Command.make("ToHost", { args: { request: ShellRequest } }, ({ request }) =>
	Effect.sync(() => {
		publish({ _tag: "Shell", request })
		return Component.noop
	}),
)

const toHost = (request: ShellRequest): Step => command(ToHost.make({ request }))

const showToast = (toast: ToastRequest): Step => toHost({ _tag: "RequestedToast", toast })

const showToastIf = (toast: ToastRequest | null | undefined): Step =>
	toast === null || toast === undefined ? unchanged : showToast(toast)

const navigateTo = (route: AppRoute, options: { readonly replace?: boolean } = {}): Step =>
	command(
		(options.replace ? Router.replace(AppRoutes, route) : Router.push(AppRoutes, route)).pipe(
			Command.asNoop,
		),
	)

// DERIVED

export const resolvedThemeOf = (model: AppModel): ResolvedTheme =>
	resolveTheme(model.themePreference.mode, model.systemTheme)

export const currentUserOf = (model: AppModel): CurrentUser | null => currentUserOfSession(model.session)

export const organizationOf = (model: AppModel): Organization | null =>
	Option.getOrNull(Option.map(loadedOrgOf(model.org, model.route), (org) => org.organization))

export const memberOf = (model: AppModel): Member | null => memberOfOrg(model.org, model.route)

/** The org shell is up: the session, its user and the route's organization have loaded. */
export const isShellReady = (model: AppModel): boolean =>
	currentUserOf(model) !== null && Option.isSome(loadedOrgOf(model.org, model.route))

export const keysOf = (model: AppModel) =>
	appKeymap.resolve(model.keybindingOverrides, model.keyboardPlatform)

const contextCache = new WeakMap<AppModel, HostContext>()

/** What the Foldkit host reads: one object per Model, so an unchanged Model sends nothing new. */
export const hostContextOf = (model: AppModel): HostContext => {
	const cached = contextCache.get(model)
	if (cached !== undefined) return cached
	const context: HostContext = {
		route: model.route,
		navigation: model.navigation,
		auth: authOf(model.session),
		currentUser: currentUserOf(model),
		organization: organizationOf(model),
		member: memberOf(model),
		isShellReady: isShellReady(model),
		isMobile: model.isMobile,
		nowMs: model.nowMs,
		themePreference: model.themePreference,
		resolvedTheme: resolvedThemeOf(model),
		soundSettings: model.soundSettings,
		keybindingOverrides: model.keybindingOverrides,
		keyboardPlatform: model.keyboardPlatform,
		unreadMentionIds: model.unreadMentionIds as ReadonlyArray<NotificationId>,
		isPaletteOpen: model.palette?.isOpen === true,
	}
	contextCache.set(model, context)
	return context
}

// SESSION

/** Automatic retries of a session check or `user.me` before the error screen waits for the user. */
export const MAX_AUTO_RETRIES = 3

/** Production builds skip the dev-only routes. Read once here, never inside `update`. */
const IS_PROD = import.meta.env.PROD

/** `beforeLoad` redirects and the signed-out gate, re-checked whenever the route or session changes. */
const redirect: Step = (model) =>
	Option.match(
		Option.orElse(routeRedirect(model.route, { isProd: IS_PROD }), () =>
			authRedirect(model.route, authOf(model.session), model.currentUrl),
		),
		{ onNone: () => unchanged(model), onSome: (route) => navigateTo(route, { replace: true })(model) },
	)

const sessionChanged: Step = redirect

/** `useAtomRefresh(userAtom)`: `user.me` again, keeping the user on screen while it runs. */
const refreshCurrentUser: Step = (model) =>
	model.session._tag !== "SignedIn"
		? unchanged(model)
		: Option.match(AsyncData.revalidateOrLoad(model.session.user), {
				onNone: () => unchanged(model),
				onSome: (user) => ({
					model: { ...model, session: Session.SignedIn({ user, retries: 0 }) },
					commands: [Commands.FetchCurrentUser.make({ delayed: false })],
				}),
			})

const signedInSession = Session.SignedIn({ user: AsyncData.Loading(), retries: 0 })

const changedAuth =
	(auth: "SignedIn" | "SignedOut"): Step =>
	(model) => {
		if (auth === "SignedOut")
			return model.session._tag === "SignedOut"
				? unchanged(model)
				: sessionChanged({ ...model, session: Session.SignedOut() })
		// A session check that confirms the session changes nothing; a new one loads its user,
		// unless the boot `user.me` is already on its way.
		if (model.session._tag === "SignedIn") return unchanged(model)
		const isFetchingUser = model.session._tag === "Loading" && model.session.isFetchingUser
		return combine([
			sessionChanged,
			isFetchingUser ? unchanged : command(Commands.FetchCurrentUser.make({ delayed: false })),
			// Signed out and in again without a reload: maybe someone else.
			model.session._tag === "SignedOut" ? command(Commands.ClearNoteDrafts.make({})) : unchanged,
		])({ ...model, session: signedInSession })
	}

/** The API did not answer the session check. A signed-in session stays: only the boot check can stall. */
const failedCheckSession =
	(reason: CommonReason): Step =>
	(model) => {
		if (model.session._tag === "SignedIn" || model.session._tag === "SignedOut") return unchanged(model)
		const retries = model.session._tag === "Unreachable" ? model.session.retries : 0
		const isAutoRetried = retries < MAX_AUTO_RETRIES
		return {
			model: { ...model, session: Session.Unreachable({ reason, retries: retries + 1 }) },
			commands: isAutoRetried ? [Commands.CheckSession.make({ delayed: true })] : [],
		}
	}

/** `user.me` answered. Before the session check does, the answer settles the session too. */
const succeededFetchCurrentUser =
	(user: CurrentUser): Step =>
	(model) =>
		model.session._tag === "SignedOut"
			? unchanged(model)
			: sessionChanged({
					...model,
					session: Session.SignedIn({ user: AsyncData.Success({ data: user }), retries: 0 }),
				})

/** `user.me` failed. A transient failure is retried a few times; after that, or an ended session, it shows. */
const failedFetchCurrentUser =
	(reason: CommonReason): Step =>
	(model) => {
		// The boot `user.me` failed before the session check answered: that check fetches again if signed in.
		if (model.session._tag === "Loading")
			return unchanged({ ...model, session: Session.Loading({ isFetchingUser: false }) })
		if (model.session._tag !== "SignedIn") return unchanged(model)
		const { user, retries } = model.session
		// With a user on screen too (the remembered one, or the one being refreshed): the retries
		// run behind them, and a remembered user is only confirmed by an answer.
		if (isRetryableReason(reason) && retries < MAX_AUTO_RETRIES)
			return {
				model: { ...model, session: Session.SignedIn({ user, retries: retries + 1 }) },
				commands: [Commands.FetchCurrentUser.make({ delayed: true })],
			}
		const failed = Session.SignedIn({
			user: Option.match(AsyncData.getData(user), {
				onNone: () => AsyncData.Failure({ error: reason }),
				onSome: (data) => AsyncData.Stale({ error: reason, data }),
			}),
			retries,
		})
		// An ended session re-reads it: if it is gone, ChangedAuth sends the browser to sign-in.
		return combine([
			sessionChanged,
			reason === "SignedOut" ? command(Commands.CheckSession.make({ delayed: false })) : unchanged,
		])({ ...model, session: failed })
	}

// ORGANIZATION

const updatedOrganization =
	(orgSlug: string, organization: Organization | null): Step =>
	(model) => {
		const current = model.org
		if (current._tag === "None" || current.slug !== orgSlug) return unchanged(model)
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
		const isNew =
			next._tag === "Loaded" &&
			!(current._tag === "Loaded" && current.organization.id === next.organization.id)
		return {
			model: { ...model, org: next },
			commands:
				isNew && next._tag === "Loaded"
					? [Commands.RememberLastOrganization.make({ organizationId: next.organization.id })]
					: [],
		}
	}

/** The user's row in the loaded organization; a row for another organization is stale and ignored. */
const updatedMember =
	(organizationId: OrganizationId, member: Member | null): Step =>
	(model) => {
		const current = model.org
		if (current._tag !== "Loaded" || current.organization.id !== organizationId) return unchanged(model)
		return unchanged({
			...model,
			org: OrgState.Loaded({ ...current, member: MemberData.Success({ data: member }) }),
		})
	}

// ROUTE

/** The route and URL the Router reports; the organization follows its slug. */
const withRoute = (model: AppModel, route: AppRoute): AppModel => ({
	...model,
	route,
	navigation: model.navigation + 1,
	currentUrl: currentUrlOf(),
	org: orgStateFor(model.org, route),
})

/** The browser's `pathname + search`: the URL as typed, with search keys the route does not model. */
export const currentUrlOf = (): string =>
	typeof location === "undefined" ? "/" : `${location.pathname}${location.search}`

// THEME

const isSameCustomization = (first: ThemeCustomization, second: ThemeCustomization) =>
	first.primary === second.primary &&
	first.grayPalette === second.grayPalette &&
	first.radius === second.radius

/** Re-applies when the resolved mode or the customization changed, and persists a user's choice. */
const transitionTheme =
	(next: (model: AppModel) => AppModel, shouldPersist: boolean): Step =>
	(previous) => {
		const model = next(previous)
		const resolved = resolvedThemeOf(model)
		const { customization } = model.themePreference
		const isApplied =
			resolved !== resolvedThemeOf(previous) ||
			!isSameCustomization(customization, previous.themePreference.customization)
		return {
			model,
			commands: [
				...(isApplied ? [Commands.ApplyTheme.make({ resolved, customization })] : []),
				...(shouldPersist
					? [Commands.SaveThemePreference.make({ preference: model.themePreference })]
					: []),
			],
		}
	}

const requestedTheme = (preference: ThemePreference): Step =>
	transitionTheme((model) => ({ ...model, themePreference: preference }), true)

const savingFailed = (title: string) =>
	showToast(errorToast(title, "It applies for now, but won't be remembered next time."))

// THE COMMAND PALETTE

/** Opens a fresh palette on `page` (today's `open`: no history), over one that is open. */
const openPalette =
	(page: PalettePage): Step =>
	(model) =>
		unchanged({ ...model, palette: { page, opened: (model.palette?.opened ?? 0) + 1, isOpen: true } })

/** A closed palette stays mounted: the Commands of its last pick (a link, a recent) still run. */
const closePalette: Step = (model) =>
	unchanged({ ...model, palette: model.palette === null ? null : { ...model.palette, isOpen: false } })

// THE HOST'S REQUESTS

const navigateHref = (href: string): Step =>
	Option.match(routeOfHref(href), {
		onNone: () => command(Commands.LoadExternal.make({ href })),
		onSome: (route) => navigateTo(route),
	})

/** A page or overlay of the Foldkit host reported a fact the shell owns. */
const handleOutMessage = (outMessage: PageOutMessage): Step =>
	PageOutMessage.match<Step>(outMessage, {
		RequestedNavigation: ({ route, replace, toast }) =>
			combine([showToastIf(toast), navigateTo(route, { replace })]),
		RequestedHref: ({ href }) => navigateHref(href),
		RequestedHistory: ({ direction }) =>
			command(
				(direction === "Back" ? Router.Back.make({}) : Router.Forward.make({})).pipe(Command.asNoop),
			),
		RequestedToast: ({ toast }) => showToast(toast),
		RequestedSignOut: () => command(Commands.SignOut.make({})),
		RequestedTheme: ({ preference }) => requestedTheme(preference),
		RequestedSoundSettings: ({ settings }) =>
			combine([
				setModel((model) => ({ ...model, soundSettings: settings })),
				command(Commands.SaveSoundSettings.make({ settings })),
			]),
		RequestedKeybindings: ({ overrides }) =>
			combine([
				setModel((model) => ({ ...model, keybindingOverrides: overrides })),
				command(Commands.SaveKeybindings.make({ overrides })),
			]),
		RequestedCurrentUserRefresh: ({ toast }) => combine([showToastIf(toast), refreshCurrentUser]),
		// The host's own: only a native page sends these, and the host does the work.
		RequestedModal: () => toHost({ _tag: "RequestedPageOut", outMessage }),
		RequestedCommandPalette: ({ page }) => openPalette(page),
		RequestedDmCreation: () => toHost({ _tag: "RequestedPageOut", outMessage }),
		RequestedUpdateCheck: () => toHost({ _tag: "RequestedPageOut", outMessage }),
		RequestedUpdateInstall: () => toHost({ _tag: "RequestedPageOut", outMessage }),
	})

const decodeModal = Schema.decodeUnknownOption(ModalRequest)

/** A native page's request: today's `PageOutMessage` where there is one, so both kinds act alike. */
const appRequest = (request: AppRequest): Step =>
	Match.valueTags(request, {
		// As `RequestedNavigation`; an href the table can't route loads in full.
		Navigate: ({ href, replace, toast }) =>
			combine([
				showToastIf(toast),
				Option.match(routeOfHref(href), {
					onNone: () => command(Commands.LoadExternal.make({ href })),
					onSome: (route) => navigateTo(route, { replace }),
				}),
			]),
		LoadPage: ({ href }) => command(Commands.LoadExternal.make({ href })),
		History: ({ direction }) => handleOutMessage(PageOutMessage.RequestedHistory({ direction })),
		ShowToast: ({ toast }) => showToast(toast),
		// A kind the registry does not know is a page bug, not the user's: nothing opens.
		OpenModal: ({ modal }) =>
			Option.match(decodeModal(modal), {
				onNone: () => unchanged,
				onSome: (decoded) => handleOutMessage(PageOutMessage.RequestedModal({ modal: decoded })),
			}),
		OpenCommandPalette: ({ page }) => handleOutMessage(PageOutMessage.RequestedCommandPalette({ page })),
		SignOut: () => handleOutMessage(PageOutMessage.RequestedSignOut()),
		CreateDm: ({ organizationId, orgSlug, userId, name }) =>
			handleOutMessage(PageOutMessage.RequestedDmCreation({ organizationId, orgSlug, userId, name })),
		SetTheme: ({ preference }) => requestedTheme(preference),
		SetSoundSettings: ({ settings }) =>
			handleOutMessage(PageOutMessage.RequestedSoundSettings({ settings })),
		SetKeybindings: ({ overrides }) =>
			handleOutMessage(PageOutMessage.RequestedKeybindings({ overrides })),
		RefreshCurrentUser: ({ toast }) => combine([showToastIf(toast), refreshCurrentUser]),
		CheckForUpdate: () => handleOutMessage(PageOutMessage.RequestedUpdateCheck()),
		InstallUpdate: () => handleOutMessage(PageOutMessage.RequestedUpdateInstall()),
	})

const receivedHostOut = (out: HostOut): Step =>
	out._tag === "Page"
		? handleOutMessage(out.outMessage)
		: (model) => ({
				model: { ...model, report: out.report },
				commands: [Commands.ApplyBadge.make({ badge: out.report.badge })],
			})

// INIT

export interface AppFlags {
	readonly themePreference: ThemePreference
	readonly systemTheme: ResolvedTheme
	readonly soundSettings: SoundSettings
	readonly keybindingOverrides: Overrides
	readonly keyboardPlatform: KeyboardPlatform
	readonly sessionStartMs: number
	readonly isMobile: boolean
	readonly rememberedUser: CurrentUser | null
}

export const init = (route: AppRoute, flags: AppFlags): Next => {
	// An app route needs the user: ask for it, and the sync token, beside the session check.
	const isAppRoute = route._tag !== "NotFound" && !isPublicRoute(route)
	const model: AppModel = {
		route,
		navigation: 0,
		currentUrl: currentUrlOf(),
		// The remembered user shows at once, from the local cache; the session check and
		// `user.me` below still decide whether the session is theirs.
		session:
			isAppRoute && flags.rememberedUser !== null
				? Session.SignedIn({ user: AsyncData.Refreshing({ data: flags.rememberedUser }), retries: 0 })
				: Session.Loading({ isFetchingUser: isAppRoute }),
		org: orgStateFor(OrgState.None(), route),
		isMobile: flags.isMobile,
		nowMs: flags.sessionStartMs,
		themePreference: flags.themePreference,
		systemTheme: flags.systemTheme,
		soundSettings: flags.soundSettings,
		keybindingOverrides: flags.keybindingOverrides,
		keyboardPlatform: flags.keyboardPlatform,
		sessionStartMs: flags.sessionStartMs,
		unreadMentionIds: [],
		report: null,
		palette: null,
	}
	return combine([
		(m) => ({
			model: m,
			commands: [
				Commands.ApplyTheme.make({
					resolved: resolvedThemeOf(m),
					customization: m.themePreference.customization,
				}),
			],
		}),
		redirect,
		isAppRoute
			? command(
					Commands.CheckSession.make({ delayed: false }),
					Commands.FetchCurrentUser.make({ delayed: false }),
					Commands.WarmAccessToken.make({}),
					Commands.WarmSyncObjects.make({
						userId: flags.rememberedUser?.id ?? null,
						channelId: chatChannelIdOf(route),
					}),
				)
			: command(Commands.CheckSession.make({ delayed: false })),
	])(model)
}

// UPDATE

/** The hotkeys the shell follows itself; the rest go to the Foldkit host, whose work they are. */
const pressedHotkey = (actionId: LayoutHotkeyActionId): Step =>
	actionId === "commandPalette.open"
		? openPalette("home")
		: // Straight into message search, as the hotkey's description says.
			actionId === "search.open"
			? openPalette("search")
			: toHost({ _tag: "PressedHotkey", actionId })

const pressedDesktopMenuItem = (item: DesktopMenuItem): Step =>
	toHost({ _tag: "PressedDesktopMenuItem", item })

export const update = (model: AppModel, message: AppMessage): Next =>
	Match.valueTags(message, {
		ChangedRoute: ({ route }) => combine([redirect])(withRoute(model, route)),
		ChangedSystemTheme: ({ theme }) =>
			transitionTheme((current) => ({ ...current, systemTheme: theme }), false)(model),
		ChangedViewport: ({ isMobile }) => unchanged({ ...model, isMobile }),
		FailedSaveThemePreference: () => savingFailed("Couldn't save your theme")(model),
		FailedSaveSoundSettings: () => savingFailed("Couldn't save your sound settings")(model),
		FailedSaveKeybindings: () => savingFailed("Couldn't save your keybinds")(model),
		UpdatedRecentNotifications: ({ ids }) =>
			ids.length === 0 ? unchanged(model) : command(Commands.DeliverNotifications.make({ ids }))(model),
		UpdatedUnreadMentions: ({ ids }) => unchanged({ ...model, unreadMentionIds: ids }),
		ChangedAuth: ({ auth }) => changedAuth(auth)(model),
		FailedCheckSession: ({ reason }) => failedCheckSession(reason)(model),
		PressedRetrySession: () =>
			model.session._tag === "Unreachable"
				? {
						model: { ...model, session: Session.Loading({ isFetchingUser: false }) },
						commands: [Commands.CheckSession.make({ delayed: false })],
					}
				: unchanged(model),
		RejectedSession: () => command(Commands.CheckSession.make({ delayed: false }))(model),
		SucceededFetchCurrentUser: ({ user }) => succeededFetchCurrentUser(user)(model),
		FailedFetchCurrentUser: ({ reason }) => failedFetchCurrentUser(reason)(model),
		PressedRetryCurrentUser: () => refreshCurrentUser(model),
		// A full load of `/`: every collection, token and subscription starts over, signed out.
		SucceededSignOut: () => command(Commands.LoadExternal.make({ href: hrefOf(AppRoute.Root()) }))(model),
		FailedSignOut: ({ reason }) =>
			showToast(
				errorToastOf({ title: "Failed to sign out", description: commonMessage(reason).description }),
			)(model),
		UpdatedOrganization: ({ orgSlug, organization }) => updatedOrganization(orgSlug, organization)(model),
		// Only a slug still loading counts: data already on screen stays when its sync hiccups.
		StalledOrganization: ({ orgSlug }) =>
			model.org._tag === "Loading" && model.org.slug === orgSlug && !model.org.isStalled
				? unchanged({ ...model, org: OrgState.Loading({ slug: orgSlug, isStalled: true }) })
				: unchanged(model),
		PressedReload: () => command(Commands.Reload.make({}))(model),
		UpdatedMember: ({ organizationId, member }) => updatedMember(organizationId, member)(model),
		TickedClock: ({ nowMs }) => unchanged({ ...model, nowMs }),
		ReceivedToast: ({ toast }) => showToast(toast)(model),
		PressedDesktopMenuItem: ({ item }) => pressedDesktopMenuItem(item)(model),
		PressedHotkey: ({ actionId }) => pressedHotkey(actionId)(model),
		ReceivedHostOut: ({ out }) => receivedHostOut(out)(model),
		ReceivedAppRequest: ({ request }) => appRequest(request)(model),
		PressedMobileSearch: () => openPalette("search")(model),
		RequestedClosePalette: () => closePalette(model),
		RequestedAiPanelFromPalette: () => toHost({ _tag: "RequestedAiPanel" })(model),
		PickedPaletteStatus: ({ status }) => toHost({ _tag: "PickedPresenceStatus", status })(model),
		PressedMobileMenu: () => toHost({ _tag: "PressedMobileMenu" })(model),
		PressedAiPanelToggle: () => toHost({ _tag: "PressedAiPanelToggle" })(model),
	})
