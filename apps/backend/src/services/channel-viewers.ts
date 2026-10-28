/**
 * Authorization inside a `ChannelObject`: the channel's readers are its `channel_viewers` (the
 * `OrgObject`'s computed `channel_access`, projected by `channel.setViewers`), with the viewer's org
 * role. Replaces `OrgResolver.fromChannelWithAccess` for handlers that run in the channel's object,
 * which holds no `channels` or `organization_members` rows.
 *
 * Also the channel's own facts from that delivery: its organization and Connect conversation. A
 * Connect host channel's object also serves its guest mounts' ids (the api Worker routes them
 * here), so a guest's write names its own mounted channel.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import { type ApiScope, CurrentBotScopes, PermissionError, scopesForRole } from "@hazel/domain/scopes"
import { type ChannelId, ConnectConversationId, OrganizationId, type UserId } from "@hazel/schema"
import { Context, Effect, Layer, Option } from "effect"
import { CurrentObject } from "../lib/current-object"

export type ChannelViewerRow = schema.ChannelViewer

/** `_object_meta` keys `channel.setViewers` writes (see `worker/objects/effects/channel-effects.ts`). */
const META_ORG = "organizationId"
const META_CONVERSATION = "conversationId"
const META_MOUNTS = "mountChannelIds"

export class ChannelViewers extends Context.Service<ChannelViewers>()("@hazel/backend/ChannelViewers", {
	make: Effect.gen(function* () {
		const db = yield* Database.Database

		const viewerOf = (userId: UserId) =>
			db
				.first(
					SQLite.from(schema.channelViewersTable)
						.select()
						.where(($) => [$.userId.eq(userId)])
						.limit(1),
				)
				.pipe(Effect.withSpan("ChannelViewers.viewerOf"))

		const meta = (key: string) =>
			db
				.query(Database.sql`SELECT value FROM _object_meta WHERE key = ${key}`)
				.pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]?.value as string | undefined)))

		/** The Connect guest mounts this host channel's object serves (routed here by `channel_index`). */
		const mountChannelIds = meta(META_MOUNTS).pipe(
			Effect.map((value) =>
				Option.match(value, {
					onNone: () => [] as ReadonlyArray<string>,
					onSome: (json) => JSON.parse(json) as ReadonlyArray<string>,
				}),
			),
		)

		/** `channelId` is this object's channel, or a Connect mount of it. */
		const serves = (channelId: ChannelId) =>
			Effect.gen(function* () {
				const object = yield* Effect.serviceOption(CurrentObject)
				if (Option.isNone(object) || object.value.kind !== "channel") return false
				if (object.value.id === channelId) return true
				return (yield* mountChannelIds).includes(channelId)
			})

		/**
		 * The actor may act on `channelId` with `scope`: this is that channel's object (or its
		 * Connect host's), the actor is a viewer, and its role (or a bot's granted scopes) includes
		 * `scope`. Fails with `PermissionError`; policies turn it into `UnauthorizedError`.
		 */
		const require = Effect.fn("ChannelViewers.require")(function* (
			channelId: ChannelId,
			scope: ApiScope,
		) {
			if (!(yield* serves(channelId))) {
				return yield* new PermissionError({
					message: `Channel ${channelId} is not served by this object`,
					requiredScope: scope,
				})
			}
			const actor = yield* CurrentUser.Context
			const viewer = yield* viewerOf(actor.id)
			if (Option.isNone(viewer)) {
				return yield* new PermissionError({
					message: "You don't have access to this channel",
					requiredScope: scope,
				})
			}
			const botScopes = Option.flatten(yield* Effect.serviceOption(CurrentBotScopes))
			const role = viewer.value.role === "guest" ? "member" : viewer.value.role
			const granted = Option.isSome(botScopes) ? botScopes.value : scopesForRole(role)
			if (!granted.has(scope)) return yield* PermissionError.insufficientScope(scope)
			return viewer.value
		})

		/** The channel's organization, once its `OrgObject` delivered viewers. */
		const organizationId = meta(META_ORG).pipe(Effect.map(Option.map((id) => OrganizationId.make(id))))

		/** The Connect conversation the channel belongs to, if any. */
		const conversationId = meta(META_CONVERSATION).pipe(
			Effect.map((value) =>
				Option.getOrNull(Option.map(value, (id) => ConnectConversationId.make(id))),
			),
		)

		return { viewerOf, require, serves, organizationId, conversationId } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
