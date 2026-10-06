import { eq } from "@tanstack/db"
import { Effect, Schema, Stream } from "effect"
import { Command, Runtime, Subscription, Update } from "foldkit"
import type { Document, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { load, pushUrl, UrlRequest } from "foldkit/navigation"
import { modifyFields } from "foldkit/struct"
import { Url, toString as urlToString } from "foldkit/url"
import {
	organizationCollection,
	organizationMemberCollection,
	userCollection,
	userPresenceStatusCollection,
} from "~/db/collections"
import { liveQueryStream } from "./data/live-query"
import { settingsLayout, TeamMember, teamPage } from "./page/team"
import { AppRoute, orgSlugOf, urlToAppRoute } from "./route"
import { HazelRpc } from "./rpc"
import { orgShell } from "./shell/app-shell"
import { applyTheme, ResolvedTheme } from "./theme"

// MODEL

const CurrentUser = Schema.Struct({
	id: Schema.String,
	firstName: Schema.String,
	lastName: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})

const Organization = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	logoUrl: Schema.NullOr(Schema.String),
})

export const Model = Schema.Struct({
	route: AppRoute,
	pathname: Schema.String,
	currentUser: Schema.NullOr(CurrentUser),
	organization: Schema.NullOr(Organization),
	teamMembers: Schema.Array(TeamMember),
	nowMs: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	ClickedLink: { request: UrlRequest },
	ChangedUrl: { url: Url },
	CompletedNavigateInternal: {},
	CompletedLoadExternal: {},
	ChangedSystemTheme: { theme: ResolvedTheme },
	CompletedApplyTheme: {},
	SucceededFetchCurrentUser: { user: CurrentUser },
	FailedFetchCurrentUser: { reason: Schema.String },
	UpdatedOrganization: { organization: Schema.NullOr(Organization) },
	UpdatedTeamMembers: { members: Schema.Array(TeamMember) },
	TickedPresenceClock: { nowMs: Schema.Number },
})
export type Message = typeof Message.Type

// COMMAND

const NavigateInternal = Command.define("NavigateInternal", {
	args: { url: Schema.String },
	messages: [Message.CompletedNavigateInternal],
	execute: ({ url }) => pushUrl(url).pipe(Effect.as(Message.CompletedNavigateInternal())),
})

const LoadExternal = Command.define("LoadExternal", {
	args: { href: Schema.String },
	messages: [Message.CompletedLoadExternal],
	execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
})

const ApplyTheme = Command.define("ApplyTheme", {
	args: { theme: ResolvedTheme },
	messages: [Message.CompletedApplyTheme],
	execute: ({ theme }) => applyTheme(theme).pipe(Effect.as(Message.CompletedApplyTheme())),
})

const FetchCurrentUser = Command.define("FetchCurrentUser", {
	args: {},
	messages: [Message.SucceededFetchCurrentUser, Message.FailedFetchCurrentUser],
	execute: () =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const user = yield* client("user.me", undefined)
			return Message.SucceededFetchCurrentUser({
				user: {
					id: user.id,
					firstName: user.firstName ?? "",
					lastName: user.lastName ?? "",
					email: user.email,
					avatarUrl: user.avatarUrl ?? null,
				},
			})
		}).pipe(
			Effect.catch((error) =>
				Effect.succeed(Message.FailedFetchCurrentUser({ reason: String(error) })),
			),
		),
})

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message, void, HazelRpc> = (url: Url) => ({
	model: {
		route: urlToAppRoute(url),
		pathname: url.pathname,
		currentUser: null,
		organization: null,
		teamMembers: [],
		nowMs: 0,
	},
	commands: [FetchCurrentUser({})],
})

// UPDATE

export const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message, HazelRpc>>(message, {
		ClickedLink: ({ request }) =>
			UrlRequest.match<Update.Return<Model, Message, HazelRpc>>(request, {
				Internal: ({ url }) => ({ model, commands: [NavigateInternal({ url: urlToString(url) })] }),
				External: ({ href }) => ({ model, commands: [LoadExternal({ href })] }),
			}),
		ChangedUrl: ({ url }) => ({
			model: modifyFields(model, { route: () => urlToAppRoute(url), pathname: () => url.pathname }),
		}),
		CompletedNavigateInternal: () => ({ model }),
		CompletedLoadExternal: () => ({ model }),
		ChangedSystemTheme: ({ theme }) => ({ model, commands: [ApplyTheme({ theme })] }),
		CompletedApplyTheme: () => ({ model }),
		SucceededFetchCurrentUser: ({ user }) => ({
			model: modifyFields(model, { currentUser: () => user }),
		}),
		FailedFetchCurrentUser: () => ({ model }),
		UpdatedOrganization: ({ organization }) => ({
			model: modifyFields(model, { organization: () => organization }),
		}),
		UpdatedTeamMembers: ({ members }) => ({ model: modifyFields(model, { teamMembers: () => members }) }),
		TickedPresenceClock: ({ nowMs }) => ({ model: modifyFields(model, { nowMs: () => nowMs }) }),
	})

// SUBSCRIPTION

interface TeamMemberRow {
	readonly id: string
	readonly userId: string
	readonly role: TeamMember["role"]
	readonly user: {
		readonly firstName: string
		readonly lastName: string
		readonly email: string
		readonly avatarUrl?: string | null
	}
	readonly presence?: { readonly status: string; readonly lastSeenAt: Date } | undefined
}

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
	systemTheme: Subscription.persistent(
		Subscription.fromMediaQuery({
			query: "(prefers-color-scheme: dark)",
			mapMatches: (isDark) => Message.ChangedSystemTheme({ theme: isDark ? "dark" : "light" }),
		}),
	),
	// Legacy `presenceNowSignal`: wall clock for deriving stale presence.
	presenceClock: Subscription.persistent(
		Stream.concat(Stream.succeed(undefined), Stream.tick("30 seconds")).pipe(
			Stream.map(() => Message.TickedPresenceClock({ nowMs: Date.now() })),
		),
	),
	organization: entry(
		{ orgSlug: Schema.NullOr(Schema.String) },
		{
			modelToDependencies: (model) => ({ orgSlug: orgSlugOf(model.route) ?? null }),
			dependenciesToStream: ({ orgSlug }) =>
				orgSlug === null
					? Stream.empty
					: liveQueryStream<{ id: string; name: string; logoUrl: string | null }, Message>(
							(q) =>
								q
									.from({ org: organizationCollection })
									.where(({ org }) => eq(org.slug, orgSlug))
									.orderBy(({ org }) => org.createdAt, "asc")
									.findOne(),
							(rows) => {
								const org = rows[0]
								return Message.UpdatedOrganization({
									organization: org
										? { id: org.id, name: org.name, logoUrl: org.logoUrl ?? null }
										: null,
								})
							},
						),
		},
	),
	teamMembers: entry(
		{ organizationId: Schema.NullOr(Schema.String) },
		{
			modelToDependencies: (model) => ({
				organizationId: model.route._tag === "TeamSettings" ? (model.organization?.id ?? null) : null,
			}),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<TeamMemberRow, Message>(
							// Same query as `routes/_app/$orgSlug/settings/team.tsx`.
							(q) =>
								q
									.from({ members: organizationMemberCollection })
									.where(({ members }) => eq(members.organizationId, organizationId))
									.innerJoin({ user: userCollection }, ({ members, user }) =>
										eq(members.userId, user.id),
									)
									.leftJoin(
										{ presence: userPresenceStatusCollection },
										({ user, presence }) => eq(user.id, presence.userId),
									)
									.where(({ user }) => eq(user.userType, "user"))
									.select(({ members, user, presence }) => ({
										...members,
										user,
										presence,
									})),
							(rows) =>
								Message.UpdatedTeamMembers({
									members: rows.map((row) => ({
										id: row.id,
										userId: row.userId,
										role: row.role,
										firstName: row.user.firstName,
										lastName: row.user.lastName,
										email: row.user.email,
										avatarUrl: row.user.avatarUrl ?? null,
										presenceStatus: row.presence?.status ?? null,
										presenceLastSeenMs: row.presence
											? new Date(row.presence.lastSeenAt).getTime()
											: null,
									})),
								}),
						),
		},
	),
}))

// VIEW

const displayNameOf = (user: typeof CurrentUser.Type) =>
	user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email || "User"

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
	title: "Hazel Chat",
	body: AppRoute.match(model.route, {
		TeamSettings: ({ orgSlug }) =>
			orgShell(
				h,
				{
					orgSlug,
					pathname: model.pathname,
					organization: model.organization ?? undefined,
					currentUser: model.currentUser
						? {
								displayName: displayNameOf(model.currentUser),
								email: model.currentUser.email,
								avatarUrl: model.currentUser.avatarUrl,
							}
						: undefined,
					appVersion: __APP_VERSION__,
				},
				settingsLayout(
					h,
					teamPage(h, {
						members: model.teamMembers,
						currentUserId: model.currentUser?.id,
						nowMs: model.nowMs,
					}),
				),
			),
		NotFound: ({ path }) => h.div([h.Id("app")], [`Not found: ${path}`]),
	}),
})
