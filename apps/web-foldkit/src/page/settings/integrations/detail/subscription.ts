import { OrganizationId, UserId } from "@hazel/schema"
import { and, eq, not } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { organizationMemberCollection, userCollection } from "~/db/collections"
import { liveQueryStream } from "../../../../data/live-query"
import type { PageSubscriptionInput } from "../../../contract"
import {
	type ConnectionRow,
	connectionsQuery,
	toConnection,
	userConnectionsQuery,
} from "../shared/connections"
import { isProvider } from "./command"
import { Message } from "./message"
import type { Model } from "./model"

interface T3CodeMemberRow {
	readonly userId: UserId
	readonly user: {
		readonly firstName: string
		readonly lastName: string
		readonly email: string
		readonly avatarUrl?: string | null
	}
}

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	connection: entry(
		{ organizationId: Schema.NullOr(OrganizationId), provider: Schema.String },
		{
			// Legacy reads `useOrganization().organizationId` here.
			modelToDependencies: ({ model, shared }) => ({
				organizationId: shared.organization?.id ?? null,
				provider: model.integrationId,
			}),
			dependenciesToStream: ({ organizationId, provider }) =>
				organizationId === null || !isProvider(provider)
					? Stream.empty
					: liveQueryStream<ConnectionRow, Message>(
							connectionsQuery(organizationId, provider),
							(rows) =>
								Message.UpdatedConnection({
									connection: rows[0] ? toConnection(rows[0]) : null,
								}),
						),
		},
	),
	// T3 Code links are the member's own; the row carries no environment or sharing, so each change refetches.
	t3CodeLink: entry(
		{
			organizationId: Schema.NullOr(OrganizationId),
			userId: Schema.NullOr(UserId),
			provider: Schema.String,
		},
		{
			modelToDependencies: ({ model, shared }) => ({
				organizationId: shared.organization?.id ?? null,
				userId: shared.currentUser?.id ?? null,
				provider: model.integrationId,
			}),
			dependenciesToStream: ({ organizationId, userId, provider }) =>
				organizationId === null || userId === null || provider !== "t3code"
					? Stream.empty
					: liveQueryStream<ConnectionRow, Message>(
							userConnectionsQuery(organizationId, userId, provider),
							() => Message.ChangedT3CodeRow(),
						),
		},
	),
	t3CodeMembers: entry(
		{
			organizationId: Schema.NullOr(OrganizationId),
			userId: Schema.NullOr(UserId),
			provider: Schema.String,
		},
		{
			modelToDependencies: ({ model, shared }) => ({
				organizationId: shared.organization?.id ?? null,
				userId: shared.currentUser?.id ?? null,
				provider: model.integrationId,
			}),
			dependenciesToStream: ({ organizationId, userId, provider }) =>
				organizationId === null || userId === null || provider !== "t3code"
					? Stream.empty
					: liveQueryStream<T3CodeMemberRow, Message>(
							(q) =>
								q
									.from({ member: organizationMemberCollection })
									.where(({ member }) =>
										and(
											eq(member.organizationId, organizationId),
											not(eq(member.userId, userId)),
										),
									)
									.innerJoin({ user: userCollection }, ({ member, user }) =>
										eq(member.userId, user.id),
									)
									.where(({ user }) => eq(user.userType, "user"))
									.select(({ member, user }) => ({ userId: member.userId, user })),
							(rows) =>
								Message.UpdatedT3CodeMembers({
									members: rows
										.map((row) => ({
											userId: row.userId,
											name:
												`${row.user.firstName} ${row.user.lastName}`.trim() ||
												row.user.email,
											email: row.user.email,
											avatarUrl: row.user.avatarUrl ?? null,
										}))
										.sort((a, b) => a.name.localeCompare(b.name)),
								}),
						),
		},
	),
}))
