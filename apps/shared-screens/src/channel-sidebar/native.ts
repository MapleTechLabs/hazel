// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The sidebar on a native host (the iOS spike, `-HazelScreen sidebar`): waits for the user's first
 * organization, mounts with `chrome` (org switcher, account card), and answers the host Commands.
 * The spike has no router: a navigation or an app request is logged; menu writes run on ClientData.
 */
import { Renderer } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import type { OrganizationId, UserId } from "@hazel/schema"
import { Effect, Layer, Option, Stream } from "effect"
import { appRequestsLayer } from "../app/requests"
import { sidebarWritesLayer } from "./actions"
import { ChannelSidebar, channelSidebarLayer } from "./ChannelSidebar"

type Data = ClientData["Service"]

const firstRow = <Row>(data: Data, query: Parameters<Data["liveQueryStream"]>[0]) =>
	data
		.liveQueryStream<Row, ReadonlyArray<Row>>(query, (rows) => rows)
		.pipe(
			Stream.filter((rows) => rows.length > 0),
			Stream.runHead,
			Effect.map(Option.flatMap((rows) => Option.fromNullishOr(rows[0]))),
		)

/** Mounts the sidebar in `container` for `userId`; runs until its scope closes. */
export const mountChannelSidebarNative = (container: Parameters<typeof Renderer.mount>[2], userId: UserId) =>
	Effect.gen(function* () {
		const data = yield* ClientData
		const rpc = yield* HazelRpc
		const org = yield* firstRow<{ id: OrganizationId; slug: string | null }>(data, (q) =>
			q.from({ org: data.collections.organizationCollection }),
		)
		if (Option.isNone(org)) return yield* Effect.die("no organization")
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
				Layer.mergeAll(
					channelSidebarLayer(
						data,
						(to) => console.log(`[sidebar] navigate ${JSON.stringify(to)}`),
						(action) =>
							Effect.sync(() => console.log(`[sidebar] action ${JSON.stringify(action)}`)),
					),
					sidebarWritesLayer(data, rpc),
					appRequestsLayer((request) =>
						console.log(`[sidebar] request ${JSON.stringify(request)}`),
					),
				),
			),
		)
	})
