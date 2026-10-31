/**
 * HTML renders in the `ChannelObject`: signed URLs for viewers only (`message.htmlRenderUrl`), and
 * the bucket cleanup (`storage.deleteHtmlRenders`) when a message stops showing a page.
 */
import { CurrentUser, UnauthorizedError } from "@hazel/domain"
import type { ChannelId, HtmlRenderId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Cause, Effect, Exit, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { htmlRenderKey, pendingHtmlRenderKey } from "../../services/html-renders"
import { channelTarget } from "./kinds"
import { encodeInvokePrincipal } from "./principal"
import { makeTestObjects, type TestObject } from "./testing"

const uuid = () => crypto.randomUUID()

const userOf = (id: string) =>
	new CurrentUser.Schema({
		id: id as UserId,
		role: "member",
		email: `${id}@example.com`,
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

const call = (object: TestObject, objectId: string, tag: HazelRpcTag, payload: unknown, user: string) =>
	Effect.gen(function* () {
		const rpc = yield* rpcFor(tag)
		const response = yield* object.invoke({
			objectId,
			tag,
			payload: yield* encodePayload(rpc, payload),
			principal: yield* encodeInvokePrincipal({ user: userOf(user), botScopes: null }),
		})
		return yield* decodeExit(rpc, structuredClone(response).exit)
	})

const ok = <A>(exit: Exit.Exit<A, unknown>) => {
	if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause))
	return exit.value as any
}

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

/**
 * A channel whose viewers are `author` and `alice`. `store` publishes a page as `author` (pending
 * until a message claims it); `stored` is whether it still exists, `claimed` whether it was kept.
 */
const makeChannel = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const orgId = uuid() as OrganizationId
	const id = uuid() as ChannelId
	const [author, alice, outsider] = [uuid(), uuid(), uuid()] as Array<UserId>
	const object = yield* objects.get(channelTarget(id))
	const applied = yield* object.applyEffect({
		objectId: id,
		kind: "channel.setViewers",
		payload: {
			organizationId: orgId,
			conversationId: null,
			viewers: [author!, alice!].map((userId) => ({ userId, organizationId: orgId, role: "member" })),
			bots: [],
		},
		key: `viewers:${id}`,
		sender: { kind: "org", id: orgId },
	})
	expect(applied._tag).toBe("Applied")
	const location = (renderId: HtmlRenderId) => ({ channelId: id, authorId: author!, renderId })
	const claimed = (renderId: HtmlRenderId) => objects.bucket.has(htmlRenderKey(location(renderId)))
	const pending = (renderId: HtmlRenderId) => objects.bucket.has(pendingHtmlRenderKey(location(renderId)))
	const stored = (renderId: HtmlRenderId) => claimed(renderId) || pending(renderId)
	const store = (renderId: HtmlRenderId) =>
		void objects.bucket.set(pendingHtmlRenderKey(location(renderId)), "<p>page</p>")
	return {
		objects,
		object,
		id,
		author: author!,
		alice: alice!,
		outsider: outsider!,
		stored,
		claimed,
		pending,
		store,
	}
})

const htmlEmbed = (renderId: HtmlRenderId) => ({ html: { renderId, title: "Chart", height: 200 } })

const create = (channel: { object: TestObject; id: ChannelId }, as: UserId, embeds: ReadonlyArray<object>) =>
	Effect.map(
		call(
			channel.object,
			channel.id,
			"message.create",
			{
				channelId: channel.id,
				content: "Report",
				embeds,
				replyToMessageId: null,
				threadChannelId: null,
				authorId: as,
				deletedAt: null,
			},
			as,
		),
		(exit) => ok(exit).data as { id: MessageId },
	)

const failedWith = (exit: Exit.Exit<unknown, unknown>, tag: string) =>
	Exit.isFailure(exit) &&
	Option.match(Cause.findErrorOption(exit.cause), {
		onNone: () => false,
		onSome: (error) => (error as { _tag?: string })._tag === tag,
	})

describe("HTML renders", () => {
	it("signs a URL for viewers, through a message that shows the render", () =>
		run(
			Effect.gen(function* () {
				const channel = yield* makeChannel
				const renderId = uuid() as HtmlRenderId
				const message = yield* create(channel, channel.author, [htmlEmbed(renderId)])
				const urlFor = (as: UserId, payload: object) =>
					call(channel.object, channel.id, "message.htmlRenderUrl", payload, as)
				const payload = { channelId: channel.id, messageId: message.id, renderId }

				const signed = ok(yield* urlFor(channel.alice, payload))
				expect(signed.url).toMatch(
					new RegExp(
						`^http://localhost:3003/html-renders/${channel.id}/${channel.author}/${renderId}\\?exp=\\d+&sig=`,
					),
				)
				expect(signed.expiresAt).toBeGreaterThan(Date.now())

				expect(failedWith(yield* urlFor(channel.outsider, payload), "UnauthorizedError")).toBe(true)
				const otherRender = { ...payload, renderId: uuid() as HtmlRenderId }
				expect(failedWith(yield* urlFor(channel.alice, otherRender), "MessageNotFoundError")).toBe(
					true,
				)
			}),
		))

	it("deletes a message's pages with it, and a page an edit replaced", () =>
		run(
			Effect.gen(function* () {
				const channel = yield* makeChannel
				const [first, second, third] = [uuid(), uuid(), uuid()] as Array<HtmlRenderId>
				for (const renderId of [first!, second!, third!]) channel.store(renderId)
				const created = yield* create(channel, channel.author, [
					htmlEmbed(first!),
					{ title: "Summary" },
				])
				const update = (payload: object) =>
					Effect.map(
						call(
							channel.object,
							channel.id,
							"message.update",
							{ channelId: channel.id, id: created.id, ...payload },
							channel.author,
						),
						ok,
					)

				// The message claimed its page: out of the expiring `pending/`.
				expect(channel.claimed(first!)).toBe(true)
				expect(channel.pending(first!)).toBe(false)

				// Editing the content alone keeps the page.
				yield* update({ content: "Report v2" })
				expect(channel.stored(first!)).toBe(true)

				// Replacing the embed's page deletes the old one.
				yield* update({ embeds: [htmlEmbed(second!)] })
				expect(channel.stored(first!)).toBe(false)
				expect(channel.claimed(second!)).toBe(true)

				ok(
					yield* call(
						channel.object,
						channel.id,
						"message.delete",
						{ channelId: channel.id, id: created.id },
						channel.author,
					),
				)
				expect(channel.stored(second!)).toBe(false)
				// A page no message showed stays pending, for the bucket's lifecycle rule to expire.
				expect(channel.pending(third!)).toBe(true)
				expect(channel.claimed(third!)).toBe(false)
			}),
		))

	it("keeps a page another of the author's messages still shows", () =>
		run(
			Effect.gen(function* () {
				const channel = yield* makeChannel
				const renderId = uuid() as HtmlRenderId
				channel.store(renderId)
				const first = yield* create(channel, channel.author, [htmlEmbed(renderId)])
				const second = yield* create(channel, channel.author, [htmlEmbed(renderId)])
				const remove = (id: MessageId) =>
					Effect.map(
						call(
							channel.object,
							channel.id,
							"message.delete",
							{ channelId: channel.id, id },
							channel.author,
						),
						ok,
					)
				yield* remove(first.id)
				expect(channel.stored(renderId)).toBe(true)
				yield* remove(second.id)
				expect(channel.stored(renderId)).toBe(false)
			}),
		))

	it("does not let another member's message resolve or delete a page", () =>
		run(
			Effect.gen(function* () {
				const channel = yield* makeChannel
				const renderId = uuid() as HtmlRenderId
				channel.store(renderId)
				yield* create(channel, channel.author, [htmlEmbed(renderId)])

				// Alice copies the reference into her own message, then deletes it.
				const copy = yield* create(channel, channel.alice, [htmlEmbed(renderId)])
				const signed = ok(
					yield* call(
						channel.object,
						channel.id,
						"message.htmlRenderUrl",
						{ channelId: channel.id, messageId: copy.id, renderId },
						channel.alice,
					),
				)
				// Her message claims nothing (she published nothing): no page under her id. Its URL names
				// her as publisher, where nothing is stored (the route answers 404).
				const hers = { channelId: channel.id, authorId: channel.alice, renderId }
				expect(channel.objects.bucket.has(htmlRenderKey(hers))).toBe(false)
				expect(channel.objects.bucket.has(pendingHtmlRenderKey(hers))).toBe(false)
				expect(signed.url).toContain(`/${channel.alice}/${renderId}`)
				ok(
					yield* call(
						channel.object,
						channel.id,
						"message.delete",
						{ channelId: channel.id, id: copy.id },
						channel.alice,
					),
				)
				expect(channel.stored(renderId)).toBe(true)
			}),
		))
})
