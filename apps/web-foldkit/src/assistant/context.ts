import type { Assistant } from "@hazel/domain/models"
import type { ChannelId, CustomerAccountId } from "@hazel/schema"
import { Match } from "effect"
import { AppRoute, type CustomerTab, customerRoute, hrefOf, orgSlugOf, titleOf } from "../route"

/**
 * What the member is looking at, sent with a message (`Assistant.Context`). A page that knows more
 * describes itself (`PageSpec.assistantContext`); any other org page gets its route's.
 */

const TITLE_SUFFIX = " · Hazel"
const MAX_LABEL = 200
const MAX_PATH = 500
const MAX_ENTITIES = 10

const bounded = (context: Assistant.Context): Assistant.Context => ({
	...context,
	label: context.label.slice(0, MAX_LABEL),
	path: context.path.slice(0, MAX_PATH),
	entities: context.entities.slice(0, MAX_ENTITIES),
})

/** A route parameter's entity kind: `accountId` is a customer, the rest are named after the parameter. */
const ENTITY_KINDS = new Map([
	["accountId", "customer"],
	["channelId", "channel"],
	["ruleId", "signal_rule"],
])

const snakeCase = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

/** The route's id parameters (`channelId`, `accountId`, ...) as entities, without names. */
const routeEntities = (route: AppRoute): Array<Assistant.ContextEntity> =>
	Object.entries(route).flatMap(([key, value]) =>
		key.endsWith("Id") && typeof value === "string"
			? [{ kind: ENTITY_KINDS.get(key) ?? snakeCase(key.slice(0, -2)), id: value }]
			: [],
	)

/** Any org page: its section ("Settings", "Customers"), path, tag and the ids in its route. */
export const routeContextOf = (route: AppRoute): Assistant.Context | null =>
	orgSlugOf(route) === undefined
		? null
		: bounded({
				label: titleOf(route).replace(TITLE_SUFFIX, ""),
				path: hrefOf(route),
				route: route._tag,
				entities: routeEntities(route),
			})

const TAB_LABELS = {
	overview: "Overview",
	users: "Users",
	billing: "Billing",
	activity: "Activity",
	notes: "Notes",
} satisfies Record<CustomerTab, string>

/** An entity the page names; its name only once known. */
const entityOf = (kind: string, id: string, name: string | null): Assistant.ContextEntity =>
	name === null ? { kind, id } : { kind, id, name }

/** A customer's page: "Acme · Billing". `name` is null until the account row syncs. */
export const customerContext = (
	orgSlug: string,
	account: Readonly<{ id: CustomerAccountId; name: string | null }>,
	tab: CustomerTab,
): Assistant.Context =>
	bounded({
		label: `${account.name ?? "Customer"} · ${TAB_LABELS[tab]}`,
		path: hrefOf(customerRoute(orgSlug, account.id, tab === "overview" ? null : tab)),
		route: "CustomerDetail",
		entities: [entityOf("customer", account.id, account.name)],
	})

/** A chat channel: "#general". `name` is null until the channel row syncs. */
export const channelContext = (
	orgSlug: string,
	channel: Readonly<{ id: ChannelId; name: string | null }>,
): Assistant.Context =>
	bounded({
		label: channel.name === null ? "Channel" : `#${channel.name}`,
		path: hrefOf(AppRoute.ChatChannel({ orgSlug, channelId: channel.id })),
		route: "ChatChannel",
		entities: [entityOf("channel", channel.id, channel.name)],
	})

const CUSTOMER_SUGGESTIONS = [
	"Summarize this customer's health",
	"What should we follow up on?",
	"Draft talking points for a call",
]
const CHANNEL_SUGGESTIONS = [
	"Summarize this channel",
	"What decisions were made recently?",
	"What questions are still open?",
]
const GENERIC_SUGGESTIONS = [
	"Summarize what's on this page",
	"What needs my attention today?",
	"Help me draft a message",
]

/** The new chat's suggestion chips, for the page the member is on. */
export const suggestionsFor = (context: Assistant.Context | null): ReadonlyArray<string> =>
	Match.value(context?.route ?? null).pipe(
		Match.when("CustomerDetail", () => CUSTOMER_SUGGESTIONS),
		Match.whenOr("ChatChannel", "ChatFiles", "ChatFilesMedia", () => CHANNEL_SUGGESTIONS),
		Match.orElse(() => GENERIC_SUGGESTIONS),
	)
