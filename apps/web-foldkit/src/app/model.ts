import { Option, Schema } from "effect"
import type { OrganizationId, UserId } from "@hazel/schema"
import { AsyncData } from "foldkit"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"
import * as CommandPalette from "../overlay/command-palette"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toaster"
import type { PageHost, Shared } from "../page/contract"
import { can } from "../page/contract"
import { PageSlot } from "../page/registry"
import { AppRoute, orgSectionOf, orgSlugOf } from "../route"
import { type Auth, CurrentUser, Member, Organization } from "../session"
import { SoundSettings } from "../notification-sound"
import { appKeymap } from "~/lib/keybindings/app-keymap"
import { Platform as KeyboardPlatform } from "~/lib/keybindings/key-combo"
import { Overrides } from "~/lib/keybindings/keymap"
import * as Platform from "../platform"
import * as Updates from "../platform/updates"
import * as Shell from "../shell/model"
import type { Context as ShellUpdateContext } from "../shell/update"
import { ResolvedTheme, resolveTheme, ThemePreference } from "../theme"

// SESSION

/** `user.me` for the signed-in session; a failure keeps its reason for the error screen. */
export const CurrentUserData = AsyncData.Schema(CurrentUser, CommonReason)
export type CurrentUserData = typeof CurrentUserData.schema.Type

/**
 * Whether the API has a session for this browser. `Unreachable` is not signed out: the API did not
 * answer, so nothing is known about the session and the app offers to try again.
 */
export const Session = defineTaggedUnion({
	/** `isFetchingUser`: the boot `user.me` runs beside the session check, so a confirmed session need not ask again. */
	Loading: { isFetchingUser: Schema.Boolean },
	Unreachable: { reason: CommonReason, retries: Schema.Number },
	SignedOut: {},
	/** `retries`: automatic `user.me` retries so far; past the limit the error screen offers one by hand. */
	SignedIn: { user: CurrentUserData.schema, retries: Schema.Number },
})
export type Session = typeof Session.Type

// ORGANIZATION

/** The user's row in the loaded organization (`usePermission`); `null` when they have none. */
export const MemberData = AsyncData.Schema(Schema.NullOr(Member), Schema.Never)
export type MemberData = typeof MemberData.schema.Type

/**
 * The organization the route names (`useOrganization()`), keyed by its slug: a switch to another
 * slug starts over at `Loading`, so the previous organization and role never show under the new one.
 */
export const OrgState = defineTaggedUnion({
	/** The route names no organization. */
	None: {},
	/** `isStalled`: not loaded after a while; the loader offers a reload. */
	Loading: { slug: Schema.String, isStalled: Schema.Boolean },
	/** No such organization, or the user is not a member. */
	NotFound: { slug: Schema.String },
	Loaded: { slug: Schema.String, organization: Organization, member: MemberData.schema },
})
export type OrgState = typeof OrgState.Type

/** The org state a route starts with: kept while the slug stays, `Loading` for a new one. */
export const orgStateFor = (current: OrgState, route: AppRoute): OrgState => {
	const slug = orgSlugOf(route)
	if (slug === undefined) return OrgState.None()
	return current._tag !== "None" && current.slug === slug
		? current
		: OrgState.Loading({ slug, isStalled: false })
}

// MODEL

/** The root Model: route, session, the active page, the shell and the overlay slots. */
export const Model = Schema.Struct({
	route: AppRoute,
	/** `pathname + search`, for `redirect_url`. */
	currentUrl: Schema.String,
	session: Session,
	org: OrgState,
	/** `useSidebar().isMobile`: the `(max-width: 767px)` viewport. */
	isMobile: Schema.Boolean,
	/** Wall clock for presence and status expiry, ticking while the signed-in shell shows. */
	nowMs: Schema.Number,
	/** The stored theme preference (`themeAtom`, `themeCustomizationAtom`), and the system's theme. */
	themePreference: ThemePreference,
	systemTheme: ResolvedTheme,
	/** `notificationSoundSettingsAtom`, stored like legacy. */
	soundSettings: SoundSettings,
	/** The user's keybinding changes (`keybindings.ts`), stored per device. */
	keybindingOverrides: Overrides,
	/** The keyboard's platform: what `Mod` means, and how keys are labeled. */
	keyboardPlatform: KeyboardPlatform,
	/** When this app load started (from Flags), for the notification sinks. */
	sessionStartMs: Schema.Number,
	page: Schema.NullOr(PageSlot),
	/** Page instances built so far: numbers the next one (`page/contract.ts`). */
	pageInstances: Schema.Int,
	shell: Shell.Model,
	modal: Modal.Model,
	commandPalette: CommandPalette.Model,
	toasts: Toasts.Model,
	/** Presence (legacy `PresenceProvider`). */
	platform: Platform.Model,
	/** The desktop app's update check and install. */
	desktopUpdate: Updates.Model,
	/** The `channel.createDm` requests in flight, by `dmRequestKey`; a repeat of one is ignored. */
	creatingDms: Schema.Array(Schema.String),
})
export type Model = typeof Model.Type

// DERIVED

/** One DM request: the member, in an org. */
export const dmRequestKey = (organizationId: OrganizationId, userId: UserId): string =>
	`${organizationId}:${userId}`

export const resolvedThemeOf = (model: Model): ResolvedTheme =>
	resolveTheme(model.themePreference.mode, model.systemTheme)

export const authOf = (session: Session): Auth =>
	Session.match(session, {
		Loading: (): Auth => "Loading",
		Unreachable: (): Auth => "Loading",
		SignedOut: (): Auth => "SignedOut",
		SignedIn: (): Auth => "SignedIn",
	})

/** The signed-in user once `user.me` has answered. */
export const currentUserOf = (model: Model): CurrentUser | null =>
	model.session._tag === "SignedIn" ? Option.getOrNull(AsyncData.getData(model.session.user)) : null

/** The organization the route names, once loaded; never another slug's. */
export const loadedOrgOf = (model: Model): Option.Option<Extract<OrgState, { _tag: "Loaded" }>> =>
	model.org._tag === "Loaded" && model.org.slug === orgSlugOf(model.route)
		? Option.some(model.org)
		: Option.none()

export const organizationOf = (model: Model): Organization | null =>
	Option.getOrNull(Option.map(loadedOrgOf(model), (org) => org.organization))

export const memberOf = (model: Model): Member | null =>
	Option.getOrNull(
		Option.flatMap(loadedOrgOf(model), (org) =>
			Option.flatMapNullishOr(AsyncData.getData(org.member), (m) => m),
		),
	)

/**
 * Per Model: the Model never changes in place, and every page Subscription reads the page host on
 * every Message (hundreds of reads of the same Model, each resolving the keymap).
 */
const sharedCache = new WeakMap<Model, Shared>()
const pageHostCache = new WeakMap<Model, PageHost>()

export const sharedOf = (model: Model): Shared => {
	const cached = sharedCache.get(model)
	if (cached !== undefined) return cached
	const shared = computeShared(model)
	sharedCache.set(model, shared)
	return shared
}

const computeShared = (model: Model): Shared => ({
	auth: authOf(model.session),
	orgSlug: orgSlugOf(model.route) ?? null,
	currentUser: currentUserOf(model),
	organization: organizationOf(model),
	member: memberOf(model),
	nowMs: model.nowMs,
	isMobile: model.isMobile,
	theme: { ...model.themePreference, resolved: resolvedThemeOf(model) },
	soundSettings: model.soundSettings,
	keys: appKeymap.resolve(model.keybindingOverrides, model.keyboardPlatform),
	keybindingOverrides: model.keybindingOverrides,
	keyboardPlatform: model.keyboardPlatform,
	desktopUpdate: model.desktopUpdate,
	isOverlayOpen: model.modal.current !== null || model.commandPalette.isOpen,
})

export const pageHostOf = (model: Model): PageHost => {
	const cached = pageHostCache.get(model)
	if (cached !== undefined) return cached
	const host = { page: model.page, shared: sharedOf(model) }
	pageHostCache.set(model, host)
	return host
}

export const shellContextOf = (model: Model): ShellUpdateContext => ({
	orgSlug: orgSlugOf(model.route) ?? null,
	isChatSection: orgSectionOf(model.route) === "Chat",
	canCreateChannel: can(sharedOf(model), "channel.create"),
	organizationId: organizationOf(model)?.id ?? null,
	currentUserId: currentUserOf(model)?.id ?? null,
	isMobile: model.isMobile,
})
