// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Every app's route table (the web's `route.ts`, the native app's router), on Effect UI's `Route`.
 * A route value is flat (`{ _tag: "ChatChannel", orgSlug, channelId }`), with a query field as an
 * `Option`; parsing and printing run through one `Route.union` whose templates name the same fields.
 *
 * As the web's table always did: an unknown path, a path param that fails to decode, or a query
 * value that fails to decode is `NotFound` (its pathname), and query keys the table does not model
 * are dropped.
 */
import { Route, UiSchema } from "@effect/ui"
import { RegisteredProvider } from "@hazel/customer-integrations"
import { SignalTemplate } from "@hazel/domain/customers"
import {
	ChannelId,
	CustomerAccountId,
	CustomerSignalRuleId,
	OrganizationId,
	SyncConnectionId,
	UserId,
} from "@hazel/schema"
import { Option, Schema } from "effect"

/** The customer page's tabs (`?tab=`). */
export const CustomerTab = Schema.Literals(["overview", "users", "billing", "activity", "notes"])
export type CustomerTab = typeof CustomerTab.Type

/** A query field's value schema, by the flat field it backs (`Schema.Option` hides it). */
const queryValues = new WeakMap<object, Schema.Top>()

/** A query field: `Option` on the route value, absent from the URL when `None`. */
const query = <S extends Schema.Top>(value: S) => {
	const field = Schema.Option(value)
	queryValues.set(field, value)
	return field
}

interface Def<Fields extends Schema.Struct.Fields> {
	readonly path: string
	readonly fields: Fields
	/** URL query keys that differ from the field names (`redirectUrl` is `redirect_url`). */
	readonly keys: { readonly [K in keyof Fields]?: string }
}

const def = <const Fields extends Schema.Struct.Fields = {}>(
	path: string,
	fields?: Fields,
	keys: { readonly [K in keyof Fields]?: string } = {},
): Def<Fields> => ({ path, fields: (fields ?? {}) as Fields, keys })

const org = { orgSlug: Schema.String }
const channel = { ...org, channelId: ChannelId }
const redirect = { redirectUrl: "redirect_url" } as const
const callback = { connectionStatus: "connection_status", errorCode: "error_code" } as const

const defs = {
	Root: def("/"),
	/** `?error=`: why the OAuth callback sent the visitor back (the API's redirect on a failed callback). */
	SignIn: def("/sign-in", { redirectUrl: query(Schema.String), error: query(Schema.String) }, redirect),
	SignUp: def("/sign-up", { redirectUrl: query(Schema.String) }, redirect),
	/** Where the OAuth callback sends a first-time user to pick their name (`?flowId=&reference=`). */
	AuthRegister: def("/auth/register", { flowId: query(Schema.String), reference: query(Schema.String) }),
	/** Where the OAuth callback sends a user whose provider account it just linked (`?provider=`). */
	AuthContinue: def("/auth/continue", { provider: query(Schema.String) }),
	/** The browser half of desktop sign-in (`?attempt=`), opened by the desktop app. */
	AuthDesktop: def("/auth/desktop", { attempt: query(Schema.String) }),
	Join: def("/join/:slug", { slug: Schema.String }),
	/** The link in an invitation email. */
	Invite: def("/invite/:token", { token: Schema.String }),
	/** A bot's install link (`@hazel/domain/bot-install`): `?bot_id=&redirect_uri=&state=`. */
	BotInstall: def(
		"/oauth/bot-install",
		{ botId: query(Schema.String), redirectUri: query(Schema.String), state: query(Schema.String) },
		{ botId: "bot_id", redirectUri: "redirect_uri" },
	),
	/**
	 * Hazel's MCP OAuth consent page (`GET /oauth/authorize` on the api redirects here with the same
	 * query): an agent asks to act for the signed-in user.
	 */
	OAuthAuthorize: def(
		"/oauth/authorize",
		{
			clientId: query(Schema.String),
			redirectUri: query(Schema.String),
			responseType: query(Schema.String),
			codeChallenge: query(Schema.String),
			codeChallengeMethod: query(Schema.String),
			scope: query(Schema.String),
			state: query(Schema.String),
			resource: query(Schema.String),
		},
		{
			clientId: "client_id",
			redirectUri: "redirect_uri",
			responseType: "response_type",
			codeChallenge: "code_challenge",
			codeChallengeMethod: "code_challenge_method",
		},
	),
	Onboarding: def("/onboarding", { orgId: query(OrganizationId), step: query(Schema.String) }),
	OnboardingSetupOrganization: def("/onboarding/setup-organization", { orgId: query(OrganizationId) }),
	SelectOrganization: def("/select-organization"),
	OrgHome: def("/:orgSlug", org),
	ChatIndex: def("/:orgSlug/chat", org),
	/** The direct messages list (a phone's DMs tab). */
	ChatDms: def("/:orgSlug/chat/dms", org),
	/** A phone's More tab: the account, the workspace and the sections the tab bar has no room for. */
	OrgMore: def("/:orgSlug/more", org),
	ChatChannel: def("/:orgSlug/chat/:channelId", channel),
	ChatFiles: def("/:orgSlug/chat/:channelId/files", channel),
	ChatFilesMedia: def("/:orgSlug/chat/:channelId/files/media", channel),
	ChannelSettings: def("/:orgSlug/channels/:channelId/settings", channel),
	ChannelSettingsOverview: def("/:orgSlug/channels/:channelId/settings/overview", channel),
	ChannelSettingsIntegrations: def("/:orgSlug/channels/:channelId/settings/integrations", channel),
	ChannelSettingsConnect: def("/:orgSlug/channels/:channelId/settings/connect", channel),
	MySettingsAppearance: def("/:orgSlug/my-settings", org),
	MySettingsProfile: def("/:orgSlug/my-settings/profile", org),
	/** The agents (MCP OAuth apps and personal tokens) that may act for the user. */
	MySettingsAgents: def("/:orgSlug/my-settings/agents", org),
	/** The OAuth callback redirect's `?connection_status=&provider=&error_code=`. */
	MySettingsLinkedAccounts: def(
		"/:orgSlug/my-settings/linked-accounts",
		{
			...org,
			connectionStatus: query(Schema.String),
			provider: query(Schema.String),
			errorCode: query(Schema.String),
		},
		callback,
	),
	MySettingsNotifications: def("/:orgSlug/my-settings/notifications", org),
	MySettingsDesktop: def("/:orgSlug/my-settings/desktop", org),
	MySettingsKeybinds: def("/:orgSlug/my-settings/keybinds", org),
	/** The inbox's tabs (Discord's): Mentions, the default, Unreads and All. */
	NotificationsMentions: def("/:orgSlug/notifications", org),
	NotificationsUnreads: def("/:orgSlug/notifications/unreads", org),
	NotificationsAll: def("/:orgSlug/notifications/all", org),
	/** The former per-source tabs; the web's `routeRedirect` sends them to All. */
	NotificationsGeneral: def("/:orgSlug/notifications/general", org),
	NotificationsThreads: def("/:orgSlug/notifications/threads", org),
	NotificationsDms: def("/:orgSlug/notifications/dms", org),
	Profile: def("/:orgSlug/profile/:userId", { ...org, userId: UserId }),
	SettingsGeneral: def("/:orgSlug/settings", org),
	TeamSettings: def("/:orgSlug/settings/team", org),
	SettingsGroups: def("/:orgSlug/settings/groups", org),
	SettingsInvitations: def("/:orgSlug/settings/invitations", org),
	SettingsCustomEmojis: def("/:orgSlug/settings/custom-emojis", org),
	SettingsDebug: def("/:orgSlug/settings/debug", org),
	SettingsConnectInvites: def("/:orgSlug/settings/connect-invites", org),
	SettingsChatSync: def("/:orgSlug/settings/chat-sync", org),
	SettingsChatSyncConnection: def("/:orgSlug/settings/chat-sync/:connectionId", {
		...org,
		connectionId: SyncConnectionId,
	}),
	SettingsIntegrations: def("/:orgSlug/settings/integrations", org),
	SettingsIntegrationsInstalled: def("/:orgSlug/settings/integrations/installed", org),
	SettingsIntegrationsMarketplace: def("/:orgSlug/settings/integrations/marketplace", org),
	SettingsIntegrationsYourApps: def("/:orgSlug/settings/integrations/your-apps", org),
	/** The OAuth callback redirect's `?connection_status=&error_code=` (its `provider` is dropped). */
	SettingsIntegration: def(
		"/:orgSlug/settings/integrations/:integrationId",
		{
			...org,
			integrationId: Schema.String,
			connectionStatus: query(Schema.String),
			errorCode: query(Schema.String),
		},
		callback,
	),
	/** `/$orgSlug/customers`: revenue and usage across the org's customers. */
	CustomersOverview: def("/:orgSlug/customers", org),
	/** The ranked signal queue. */
	CustomersAttention: def("/:orgSlug/customers/attention", org),
	/** Support issues across the linked channels (`docs/customers/issues.md`). */
	CustomersInbox: def("/:orgSlug/customers/inbox", org),
	/** Response times, % within SLA and breaches over a range (`docs/customers/sla.md`). */
	CustomersSupportReport: def("/:orgSlug/customers/support", org),
	/** `?view=`: a saved view's id, or a built-in view's key (`BuiltInViewKey`, e.g. `paying`). */
	CustomersList: def("/:orgSlug/customers/list", { ...org, view: query(Schema.String) }),
	/** One customer; `?tab=` picks the tab (none: overview). */
	CustomerDetail: def("/:orgSlug/customers/:accountId", {
		...org,
		accountId: CustomerAccountId,
		tab: query(CustomerTab),
	}),
	CustomersSettingsSignals: def("/:orgSlug/customers/settings/signals", org),
	/** The rule editor for a new rule; `?template=` preselects the template picked in the modal. */
	CustomersSettingsSignalNew: def("/:orgSlug/customers/settings/signals/new", {
		...org,
		template: query(SignalTemplate),
	}),
	CustomersSettingsSignalRule: def("/:orgSlug/customers/settings/signals/:ruleId", {
		...org,
		ruleId: CustomerSignalRuleId,
	}),
	CustomersSettingsPlans: def("/:orgSlug/customers/settings/plans", org),
	CustomersSettingsSla: def("/:orgSlug/customers/settings/sla", org),
	CustomersSettingsFeatureFlags: def("/:orgSlug/customers/settings/feature-flags", org),
	CustomersSettingsSources: def("/:orgSlug/customers/settings/sources", org),
	CustomersSourceDetail: def("/:orgSlug/customers/settings/sources/:provider", {
		...org,
		provider: RegisteredProvider,
	}),
	CustomersUnmatched: def("/:orgSlug/customers/settings/sources/unmatched", org),
	NotFound: def("/*", { path: Schema.String }),
}

type Defs = typeof defs
type FieldsOf = { readonly [Tag in keyof Defs]: Defs[Tag]["fields"] }

const fieldsByTag = Object.fromEntries(
	Object.entries(defs).map(([tag, route]) => [tag, route.fields]),
) as unknown as FieldsOf

/** Every route: a constructor per tag (`AppRoute.ChatChannel({ orgSlug, channelId })`), `match`, `isAnyOf`. */
export const AppRoute = UiSchema.TaggedEnum(fieldsByTag)
export type AppRoute = typeof AppRoute.Type
export type RouteTag = AppRoute["_tag"]
export type RouteOf<Tag extends RouteTag> = Extract<AppRoute, { readonly _tag: Tag }>

const templateParams = (path: string) =>
	new Set(
		path
			.split("/")
			.filter((segment) => segment.startsWith(":"))
			.map((segment) => segment.slice(1)),
	)

/** One field of a route value as the URL carries it: a path param, or a query key. */
interface Slot {
	readonly field: string
	readonly key: string
	readonly isQuery: boolean
}

const slots: Record<string, ReadonlyArray<Slot>> = {}

/** The Effect UI table the values parse and print through. */
const table = Route.union(
	Object.fromEntries(
		Object.entries(defs).map(([tag, route]): [string, Route.Any] => {
			if (tag === "NotFound") return [tag, Route.make("/*", { params: { "*": Schema.String } })]
			const inPath = templateParams(route.path)
			const params: Record<string, Schema.Constraint> = {}
			const search: Record<string, Schema.Constraint> = {}
			const keys = route.keys as Record<string, string | undefined>
			const tagSlots: Array<Slot> = []
			for (const [field, schema] of Object.entries(route.fields as Schema.Struct.Fields)) {
				if (inPath.has(field)) {
					params[field] = schema
					tagSlots.push({ field, key: field, isQuery: false })
					continue
				}
				const value = queryValues.get(schema)
				if (value === undefined)
					throw new Error(`route ${tag}: ${field} is neither a param nor a query`)
				const key = keys[field] ?? field
				search[key] = Schema.optional(value)
				tagSlots.push({ field, key, isQuery: true })
			}
			slots[tag] = tagSlots
			// SAFETY: the templates' params are the fields named in them, checked by `Route.make` at load.
			return [tag, Route.make(route.path, { params, search } as never)]
		}),
	) as Record<string, Route.Any>,
)

interface TableRoute {
	readonly _tag: string
	readonly params: Readonly<Record<string, unknown>>
	readonly search: Readonly<Record<string, unknown>>
}

const pathnameOf = (href: string) => {
	const end = href.search(/[?#]/)
	const path = end < 0 ? href : href.slice(0, end)
	return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path
}

/** The route of a same-origin href (`/x?y`); anything the table can't take is `NotFound`. */
export const routeOfPath = (href: string): AppRoute => {
	const path = href.startsWith("/") ? href : `/${href}`
	const notFound = AppRoute.NotFound({ path: pathnameOf(path) })
	const resolved = Option.getOrUndefined(table.resolve(path))
	if (resolved === undefined || resolved.invalid.length > 0) return notFound
	// SAFETY: the union's values are `{ _tag, params, search }` (Effect UI's route value).
	const route = resolved.route as unknown as TableRoute
	if (route._tag === "NotFound") return notFound
	const flat: Record<string, unknown> = { _tag: route._tag }
	for (const slot of slots[route._tag] ?? []) {
		flat[slot.field] = slot.isQuery
			? Option.fromNullishOr(route.search[slot.key])
			: route.params[slot.key]
	}
	// SAFETY: built field by field from the tag's own slots, decoded by its schemas.
	return flat as AppRoute
}

/** The URL a route value prints to; `routeOfPath(hrefOf(route))` gives the route back. */
export const hrefOf = (route: AppRoute): string => {
	if (route._tag === "NotFound") return route.path
	const values = route as unknown as Readonly<Record<string, unknown>>
	const params: Record<string, unknown> = {}
	const search: Record<string, unknown> = {}
	for (const slot of slots[route._tag] ?? []) {
		const value = values[slot.field]
		if (!slot.isQuery) params[slot.key] = value
		else if (Option.isOption(value) && Option.isSome(value)) search[slot.key] = value.value
	}
	// SAFETY: the table's own value shape for this tag (`TableRoute`).
	const href = table.print({ _tag: route._tag, params, search } as never)
	// A space in the query prints as `+`, as `URLSearchParams` (and the web's links) always did; a
	// literal `+` is already `%2B`.
	const at = href.indexOf("?")
	return at < 0 ? href : `${href.slice(0, at)}${href.slice(at).replaceAll("%20", "+")}`
}

/** The printed path of a route, without its query. */
export const pathOf = (route: AppRoute): string => pathnameOf(hrefOf(route))

export const orgSlugOf = (route: AppRoute): string | undefined =>
	"orgSlug" in route ? route.orgSlug : undefined
