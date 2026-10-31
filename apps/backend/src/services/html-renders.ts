/**
 * HTML renders (`@hazel/domain/html-render`): pages bots publish for message embeds. Each lives in
 * the private `html-renders` R2 bucket (`HtmlRenderStore`, never the public uploads bucket) at
 * `html-renders/<channelId>/<authorId>/<renderId>.html`, bootstrap already injected. Keyed by its
 * publisher, so a message by anyone else that names the render resolves (and deletes) nothing.
 *
 * Clients never reach the bucket: `message.htmlRenderUrl` (the channel's object, viewers only, for
 * a message that shows the render) signs a short-lived URL for `GET /html-renders/<key>`, which
 * serves the page with the sandbox CSP (`worker/html-render-route.ts`). The signing key is derived
 * from the uploads bucket's secret, so it needs no config of its own and rotates with it.
 */
import {
	findViewportHeightUnit,
	HTML_RENDER_MAX_BYTES,
	HTML_RENDER_MAX_TITLE_LENGTH,
	clampHtmlRenderHeight,
	injectHtmlRenderBootstrap,
} from "@hazel/domain/html-render"
import type { MessageEmbed } from "@hazel/domain/models"
import { HtmlRenderRejectedError } from "@hazel/domain/http"
import { type ChannelId, HtmlRenderId, type UserId } from "@hazel/schema"
import type { R2Bucket } from "@cloudflare/workers-types"
import { Clock, Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

/** How long a signed URL serves the page. */
export const HTML_RENDER_URL_TTL_MS = 60 * 60 * 1000

const KEY_LABEL = "hazel/html-render-url/v1"

/** Where a render's page lives, and what a signed URL names. */
export interface HtmlRenderLocation {
	readonly channelId: ChannelId
	readonly authorId: UserId
	readonly renderId: HtmlRenderId
}

const locationPath = ({ channelId, authorId, renderId }: HtmlRenderLocation) =>
	`${channelId}/${authorId}/${renderId}`

export const htmlRenderKey = (location: HtmlRenderLocation) => `html-renders/${locationPath(location)}.html`

const encoder = new TextEncoder()

const base64Url = (bytes: ArrayBuffer) =>
	btoa(String.fromCharCode(...new Uint8Array(bytes)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> | undefined => {
	try {
		const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"))
		return Uint8Array.from(binary, (char) => char.charCodeAt(0))
	} catch {
		return undefined
	}
}

const signedContent = (location: HtmlRenderLocation, expiresAt: number) =>
	encoder.encode(`${locationPath(location)}/${expiresAt}`)

export class HtmlRenderStoreError extends Schema.TaggedError<HtmlRenderStoreError>()("HtmlRenderStoreError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

export interface HtmlRenderStoreShape {
	readonly put: (key: string, html: string) => Effect.Effect<void, HtmlRenderStoreError>
	/** `None` when there is no such page. */
	readonly getText: (key: string) => Effect.Effect<Option.Option<string>, HtmlRenderStoreError>
	/** A missing page counts as deleted. */
	readonly remove: (key: string) => Effect.Effect<void, HtmlRenderStoreError>
}

/** The pages' bucket: private, so a page is only ever served by `GET /html-renders/...`. */
export class HtmlRenderStore extends Context.Service<HtmlRenderStore, HtmlRenderStoreShape>()(
	"@hazel/backend/HtmlRenderStore",
) {
	/** Cloudflare Workers: the `HTML_RENDERS` R2 binding. */
	static readonly layerR2 = (bucket: R2Bucket): Layer.Layer<HtmlRenderStore> => {
		const use = <A>(what: string, run: () => Promise<A>) =>
			Effect.tryPromise({
				try: run,
				catch: (cause) => new HtmlRenderStoreError({ message: `Failed to ${what}`, cause }),
			})
		return Layer.succeed(this, {
			put: Effect.fn("HtmlRenderStore.put")(function* (key, html) {
				yield* use(`store ${key}`, () =>
					bucket.put(key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } }),
				)
			}),
			getText: Effect.fn("HtmlRenderStore.getText")(function* (key) {
				const object = yield* use(`read ${key}`, () => bucket.get(key))
				if (object === null) return Option.none()
				return Option.some(yield* use(`read ${key}`, () => object.text()))
			}),
			remove: Effect.fn("HtmlRenderStore.remove")(function* (key) {
				yield* use(`delete ${key}`, () => bucket.delete(key))
			}),
		})
	}
}

/** The render ids an embed list references. */
export const htmlRenderIdsOf = (embeds: ReadonlyArray<MessageEmbed.MessageEmbed> | null | undefined) =>
	(embeds ?? []).flatMap((embed) => (embed.html === undefined ? [] : [embed.html.renderId]))

export class HtmlRenders extends Context.Service<HtmlRenders>()("@hazel/backend/HtmlRenders", {
	make: Effect.gen(function* () {
		const storage = yield* HtmlRenderStore
		const apiBaseUrl = (yield* Config.String("API_BASE_URL")).replace(/\/+$/, "")
		const bucketSecret = yield* Config.Redacted("S3_SECRET_ACCESS_KEY")

		// HMAC(bucket secret, label) as the HMAC key: the bucket secret itself never signs.
		const signingKey = yield* Effect.promise(async () => {
			const root = await crypto.subtle.importKey(
				"raw",
				encoder.encode(Redacted.value(bucketSecret)),
				{ name: "HMAC", hash: "SHA-256" },
				false,
				["sign"],
			)
			const derived = await crypto.subtle.sign("HMAC", root, encoder.encode(KEY_LABEL))
			return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, [
				"sign",
				"verify",
			])
		})

		/** Check, bootstrap and store a page; the reference goes in a message embed's `html`. */
		const publish = Effect.fn("HtmlRenders.publish")(function* (input: {
			readonly channelId: ChannelId
			/** The publisher: only its messages can show the page. */
			readonly authorId: UserId
			readonly title: string
			readonly html: string
			readonly height: number
		}) {
			const bytes = encoder.encode(input.html).byteLength
			if (bytes > HTML_RENDER_MAX_BYTES) {
				return yield* new HtmlRenderRejectedError({
					message: `The page is larger than ${HTML_RENDER_MAX_BYTES} bytes.`,
				})
			}
			const viewportUnit = findViewportHeightUnit(input.html)
			if (viewportUnit !== undefined) {
				return yield* new HtmlRenderRejectedError({
					message: `The page uses a viewport height unit (${viewportUnit}). The frame grows to fit the page, so a size that follows the viewport grows it again and again. Let content set the height, or use fixed pixel heights.`,
				})
			}
			const renderId = HtmlRenderId.make(crypto.randomUUID())
			yield* Effect.annotateCurrentSpan({
				"html_render.id": renderId,
				"html_render.bytes": bytes,
			})
			yield* storage.put(
				htmlRenderKey({ channelId: input.channelId, authorId: input.authorId, renderId }),
				injectHtmlRenderBootstrap(input.html),
			)
			return {
				renderId,
				title: input.title.trim().slice(0, HTML_RENDER_MAX_TITLE_LENGTH) || "HTML",
				height: clampHtmlRenderHeight(input.height),
			}
		})

		/** A URL serving the page until `expiresAt` (epoch ms). */
		const signedUrl = Effect.fn("HtmlRenders.signedUrl")(function* (location: HtmlRenderLocation) {
			const expiresAt = (yield* Clock.currentTimeMillis) + HTML_RENDER_URL_TTL_MS
			const signature = yield* Effect.promise(() =>
				crypto.subtle.sign("HMAC", signingKey, signedContent(location, expiresAt)),
			)
			const url = `${apiBaseUrl}/html-renders/${locationPath(location)}?exp=${expiresAt}&sig=${base64Url(signature)}`
			return { url, expiresAt }
		})

		/** The URL's signature is ours and has not expired. */
		const verify = Effect.fn("HtmlRenders.verify")(function* (
			location: HtmlRenderLocation,
			expiresAt: number,
			signature: string,
		) {
			if (!Number.isSafeInteger(expiresAt) || expiresAt < (yield* Clock.currentTimeMillis)) return false
			const bytes = fromBase64Url(signature)
			if (bytes === undefined) return false
			// A signature WebCrypto cannot check is not ours.
			return yield* Effect.tryPromise(() =>
				crypto.subtle.verify("HMAC", signingKey, bytes, signedContent(location, expiresAt)),
			).pipe(Effect.orElseSucceed(() => false))
		})

		const read = (location: HtmlRenderLocation) => storage.getText(htmlRenderKey(location))

		const remove = (location: HtmlRenderLocation) => storage.remove(htmlRenderKey(location))

		return { publish, signedUrl, verify, read, remove } as const
	}),
}) {
	/** Needs `HtmlRenderStore` from the platform (`worker/platform.ts`). */
	static readonly layer = Layer.effect(this, this.make)
}
