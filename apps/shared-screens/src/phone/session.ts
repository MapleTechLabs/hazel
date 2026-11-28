// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The phone's session (`CurrentSession`): the signed-in user and their membership in the chosen
 * organization, live from the synced rows. `SwitchOrganization` (the org switcher) changes the
 * organization and `refreshUser` asks `user.me` again (after a profile change); the shell follows.
 */
import { ClientData, HazelRpc } from "@hazel/client-data"
import type { CurrentUser } from "@hazel/domain"
import type { OrganizationId } from "@hazel/schema"
import { and, eq } from "@tanstack/db"
import { Effect, Layer, Stream, SubscriptionRef } from "effect"
import { CurrentSession } from "../app/current-session"
import type { Session, SessionMember, SessionOrganization, SessionUser } from "../app/session"
import { SwitchOrganization } from "../shell/Chrome"

interface MembershipRow {
	readonly member: { readonly id: SessionMember["id"]; readonly role: SessionMember["role"] }
	readonly organization: SessionOrganization
}

const userOf = (me: CurrentUser.Schema): SessionUser => ({
	id: me.id,
	firstName: me.firstName ?? "",
	lastName: me.lastName ?? "",
	email: me.email,
	avatarUrl: me.avatarUrl ?? null,
	isOnboarded: me.isOnboarded,
})

/** `CurrentSession` and `SwitchOrganization` for `me` in `organizationId`, and `refreshUser`. */
export const makePhoneSession = (me: CurrentUser.Schema, organizationId: OrganizationId) =>
	Effect.gen(function* () {
		const data = yield* ClientData
		const rpc = yield* HazelRpc
		const user = yield* SubscriptionRef.make(userOf(me))
		const organization = yield* SubscriptionRef.make(organizationId)
		const { organizationMemberCollection, organizationCollection } = data.collections
		const membershipIn = (orgId: OrganizationId) =>
			data.liveQueryStream<MembershipRow, MembershipRow | undefined>(
				(q) =>
					q
						.from({ member: organizationMemberCollection })
						.innerJoin({ org: organizationCollection }, ({ member, org }) =>
							eq(org.id, member.organizationId),
						)
						.where(({ member }) =>
							and(eq(member.userId, me.id), eq(member.organizationId, orgId)),
						)
						.select(({ member, org }) => ({
							member: { id: member.id, role: member.role },
							organization: {
								id: org.id,
								name: org.name,
								slug: org.slug,
								logoUrl: org.logoUrl,
							},
						})),
				(rows) => rows[0],
			)
		const changes = Stream.zipLatest(
			SubscriptionRef.changes(user),
			SubscriptionRef.changes(organization).pipe(Stream.switchMap(membershipIn)),
		).pipe(
			Stream.filter(([, row]) => row !== undefined),
			Stream.map(([sessionUser, row]): Session => ({
				auth: "SignedIn",
				user: sessionUser,
				organization: row?.organization ?? null,
				member: row?.member ?? null,
				orgSlug: row?.organization.slug ?? null,
			})),
		)
		return {
			layer: Layer.mergeAll(
				Layer.succeed(CurrentSession, { changes }),
				SwitchOrganization.layerWith((id) => Effect.runSync(SubscriptionRef.set(organization, id))),
			),
			/** `user.me` again, into the session (a changed name or avatar). */
			refreshUser: rpc("user.me", undefined).pipe(
				Effect.flatMap((fresh) => SubscriptionRef.set(user, userOf(fresh))),
				Effect.ignore,
			),
		}
	})
