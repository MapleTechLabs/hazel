import { OrganizationId, UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { organizationCollection, organizationMemberCollection } from "~/db/collections"
import { liveQueryStream } from "../data/live-query"
import { pageSubscriptions } from "../page/registry"
import { orgSlugOf } from "../route"
import type { Member, Organization } from "../session"
import * as ShellSubscription from "../shell/subscription"
import { clerkAuthStream } from "./clerk"
import { Message } from "./message"
import { type Model, pageHostOf, sharedOf } from "./model"

const rootSubscriptions = Subscription.make<Model, Message>()((entry) => ({
	systemTheme: Subscription.persistent(
		Subscription.fromMediaQuery({
			query: "(prefers-color-scheme: dark)",
			mapMatches: (isDark) => Message.ChangedSystemTheme({ theme: isDark ? "dark" : "light" }),
		}),
	),
	auth: Subscription.persistent(clerkAuthStream.pipe(Stream.map((auth) => Message.ChangedAuth({ auth })))),
	// Legacy `presenceNowSignal`: wall clock for deriving stale presence.
	presenceClock: Subscription.persistent(
		Stream.concat(Stream.succeed(undefined), Stream.tick("30 seconds")).pipe(
			Stream.map(() => Message.TickedPresenceClock({ nowMs: Date.now() })),
		),
	),
	// `useOrganization()`: the org named by the route's slug.
	organization: entry(
		{ orgSlug: Schema.NullOr(Schema.String) },
		{
			modelToDependencies: (model) => ({ orgSlug: orgSlugOf(model.route) ?? null }),
			dependenciesToStream: ({ orgSlug }) =>
				orgSlug === null
					? Stream.empty
					: liveQueryStream<Organization, Message>(
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
										? {
												id: org.id,
												name: org.name,
												slug: org.slug ?? null,
												logoUrl: org.logoUrl ?? null,
											}
										: null,
								})
							},
						),
		},
	),
	// `usePermission()` / `useOrganizationMember()`: the user's row in that org.
	member: entry(
		{ organizationId: Schema.NullOr(OrganizationId), userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: (model) => ({
				organizationId: model.organization?.id ?? null,
				userId: model.currentUser?.id ?? null,
			}),
			dependenciesToStream: ({ organizationId, userId }) =>
				organizationId === null || userId === null
					? Stream.empty
					: liveQueryStream<Member, Message>(
							(q) =>
								q
									.from({ m: organizationMemberCollection })
									.where(({ m }) => eq(m.organizationId, organizationId))
									.where(({ m }) => eq(m.userId, userId))
									.findOne(),
							(rows) => {
								const member = rows[0]
								return Message.UpdatedMember({
									member: member ? { id: member.id, role: member.role } : null,
								})
							},
						),
		},
	),
}))

const shellSubscriptions = Subscription.lift(ShellSubscription.subscriptions)<Model, Message>({
	read: (model) => Option.some({ model: model.shell, route: model.route, shared: sharedOf(model) }),
	// Literal wrappers: constructors would re-validate every row payload.
	toParentMessage: (message): Message => ({ _tag: "GotShellMessage", message }),
})

const pages = Subscription.lift(pageSubscriptions)<Model, Message>({
	read: (model) => Option.some(pageHostOf(model)),
	toParentMessage: (message): Message => ({ _tag: "GotPageMessage", message }),
})

export const subscriptions = Subscription.aggregate(rootSubscriptions, shellSubscriptions, pages)
