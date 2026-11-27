// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Activity on a native host (the iOS spike's `-HazelScreen activity`): mounted for the signed-in
 * user's first organization membership, with its own title bar, once the membership has synced.
 */
import { Renderer } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import type { ChannelId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Effect, Option, Stream } from "effect"
import { Activity, activityLayer } from "./Activity"

interface Membership {
	readonly member: { readonly id: OrganizationMemberId; readonly organizationId: OrganizationId }
	readonly organization: { readonly slug: string | null }
}

export const mountActivityLive = (
	userId: UserId,
	container: Parameters<typeof Renderer.mount>[2],
	navigate: (channelId: ChannelId) => void,
) =>
	Effect.gen(function* () {
		const data = yield* ClientData
		const rpc = yield* HazelRpc
		const { organizationMemberCollection, organizationCollection } = data.collections
		const membership = yield* Stream.runHead(
			data
				.liveQueryStream<Membership, Membership | undefined>(
					(q) =>
						q
							.from({ member: organizationMemberCollection })
							.innerJoin({ organization: organizationCollection }, ({ member, organization }) =>
								eq(organization.id, member.organizationId),
							)
							.where(({ member }) => eq(member.userId, userId)),
					(rows) => rows[0],
				)
				.pipe(Stream.filter((row): row is Membership => row !== undefined)),
		)
		if (Option.isNone(membership)) return yield* Effect.never
		return yield* Renderer.mount(
			Activity,
			{
				memberId: membership.value.member.id,
				orgSlug: membership.value.organization.slug ?? "",
				tab: "mentions",
				nowMs: Date.now(),
				titled: true,
			},
			container,
		).pipe(Effect.provide(activityLayer(data, rpc, navigate)))
	})
