// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The sidebar on a native host (the iOS spike, `-HazelScreen sidebar`): waits for the user's first
 * organization, mounts with `chrome` (org switcher, account card), and answers the host Commands.
 * The spike has no router: a navigation is logged; member toggles write through ClientData.
 */
import { Renderer } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import type { ChannelMemberId, OrganizationId, UserId } from "@hazel/schema"
import { and, eq } from "@tanstack/db"
import { Effect, Match, Option, Stream } from "effect"
import { ChannelSidebar, channelSidebarLayer, type SidebarAction } from "./ChannelSidebar"

type Data = ClientData["Service"]

const firstRow = <Row>(data: Data, query: Parameters<Data["liveQueryStream"]>[0]) =>
	data.liveQueryStream<Row, ReadonlyArray<Row>>(query, (rows) => rows).pipe(
		Stream.filter((rows) => rows.length > 0),
		Stream.runHead,
		Effect.map(Option.flatMap((rows) => Option.fromNullishOr(rows[0]))),
	)

/** The member toggles a row menu can write here; the rest is the web app's (modals, routes). */
const actOn =
	(data: Data, userId: UserId, run: (effect: Effect.Effect<unknown, unknown, HazelRpc>) => void) =>
	(action: SidebarAction): Effect.Effect<void> =>
		Effect.gen(function* () {
			console.log(`[sidebar] action ${JSON.stringify(action)}`)
			if (action._tag !== "RowMenu") return
			const member = yield* firstRow<{ id: ChannelMemberId; isFavorite: boolean }>(data, (q) =>
				q
					.from({ member: data.collections.channelMemberCollection })
					.where(({ member }) => and(eq(member.channelId, action.channelId), eq(member.userId, userId))),
			)
			if (Option.isNone(member)) return
			const memberId = member.value.id
			const update = data.actions.updateChannelMemberAction
			Match.value(action.key).pipe(
				Match.when("favorite", () => run(update({ memberId, isFavorite: !member.value.isFavorite }))),
				Match.when("hide", () => run(update({ memberId, isHidden: true }))),
				Match.when("mute:forever", () => run(update({ memberId, isMuted: true, mutedUntil: null }))),
				Match.when("mute", () => run(update({ memberId, isMuted: false, mutedUntil: null }))),
				Match.orElse(() => undefined),
			)
		})

/** Mounts the sidebar in `container` for `userId`; runs until its scope closes. */
export const mountChannelSidebarNative = (container: Parameters<typeof Renderer.mount>[2], userId: UserId) =>
	Effect.gen(function* () {
		const data = yield* ClientData
		const rpc = yield* HazelRpc
		const org = yield* firstRow<{ id: OrganizationId; slug: string | null }>(data, (q) =>
			q.from({ org: data.collections.organizationCollection }),
		)
		if (Option.isNone(org)) return yield* Effect.die("no organization")
		const run = (effect: Effect.Effect<unknown, unknown, HazelRpc>) =>
			void Effect.runFork(
				effect.pipe(
					Effect.provideService(HazelRpc, rpc),
					Effect.tapCause((cause) => Effect.sync(() => console.log(`[sidebar] write failed: ${cause}`))),
				),
			)
		console.log(`[sidebar] mounting for org ${org.value.id}`)
		return yield* Renderer.mount(
			ChannelSidebar,
			{
				organizationId: org.value.id,
				userId,
				orgSlug: org.value.slug ?? "",
				activeChannelId: null,
				membersActive: false,
				hintDismissed: false,
				paletteKey: null,
				chrome: true,
			},
			container,
		).pipe(
			Effect.provide(
				channelSidebarLayer(
					data,
					(to) => console.log(`[sidebar] navigate ${JSON.stringify(to)}`),
					actOn(data, userId, run),
				),
			),
		)
	})
