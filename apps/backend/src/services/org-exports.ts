/**
 * Organization data exports (`worker/objects/org/exports.ts`): the files live in the private
 * `org-exports` R2 bucket (`OrgExportStore`, never the public uploads bucket), one NDJSON part per
 * object at `exports/<organizationId>/<exportId>/part-<n>.ndjson`. The bucket expires them after
 * `ORG_EXPORT_RETENTION_DAYS` (`worker.ts`).
 *
 * Clients never reach the bucket: `organizationExport.downloadUrl` (the org's object, owners and
 * admins only) signs a short-lived URL for `GET /exports/<organizationId>/<exportId>`, which streams
 * the parts as one file (`worker/org-export-route.ts`). The signing key is derived from
 * `INTEGRATION_ENCRYPTION_KEY`, which every stage has, so it needs no config of its own.
 */
import type { R2Bucket } from "@cloudflare/workers-types"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

/** How long a signed download URL works. */
export const ORG_EXPORT_URL_TTL_MS = 15 * 60 * 1000

/** How long a finished export can be downloaded; the bucket deletes it a day later. */
export const ORG_EXPORT_RETENTION_DAYS = 7
export const ORG_EXPORT_PREFIX = "exports/"

const KEY_LABEL = "hazel/org-export-url/v1"

/** What a signed URL names: one export, and how many parts it has. */
export interface OrgExportLocation {
	readonly organizationId: string
	readonly exportId: string
	readonly parts: number
}

export const orgExportPartKey = (organizationId: string, exportId: string, index: number) =>
	`${ORG_EXPORT_PREFIX}${organizationId}/${exportId}/part-${String(index).padStart(6, "0")}.ndjson`

export class OrgExportStoreError extends Schema.TaggedError<
	OrgExportStoreError,
	{ readonly brand: unique symbol }
>()("OrgExportStoreError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

export interface OrgExportFiles {
	readonly put: (key: string, body: string) => Effect.Effect<void, OrgExportStoreError>
	/** One part's bytes (a few MB at most); `None` when there is no such object. */
	readonly read: (key: string) => Effect.Effect<Option.Option<Uint8Array>, OrgExportStoreError>
}

/** The exports' bucket: private, so a file is only ever served by the signed `GET /exports/...`. */
export class OrgExportStore extends Context.Service<OrgExportStore, OrgExportFiles>()(
	"@hazel/backend/OrgExportStore",
) {
	/** Cloudflare Workers: the `ORG_EXPORTS` R2 binding. */
	static readonly layerR2 = (bucket: R2Bucket): Layer.Layer<OrgExportStore> => {
		const use = <A>(what: string, run: () => Promise<A>) =>
			Effect.tryPromise({
				try: run,
				catch: (cause) => new OrgExportStoreError({ message: `Failed to ${what}`, cause }),
			})
		return Layer.succeed(this, {
			put: Effect.fn("OrgExportStore.put")(function* (key, body) {
				yield* use(`store ${key}`, () =>
					bucket.put(key, body, {
						httpMetadata: { contentType: "application/x-ndjson; charset=utf-8" },
					}),
				)
			}),
			read: Effect.fn("OrgExportStore.read")(function* (key) {
				const object = yield* use(`read ${key}`, () => bucket.get(key))
				if (object === null) return Option.none()
				return Option.some(new Uint8Array(yield* use(`read ${key}`, () => object.arrayBuffer())))
			}),
		})
	}

	/** In memory (tests, and a local stack without the binding). */
	static readonly layerMemory = (files: Map<string, string>): Layer.Layer<OrgExportStore> =>
		Layer.succeed(this, {
			put: (key, body) => Effect.sync(() => void files.set(key, body)),
			read: (key) =>
				Effect.sync(() => {
					const body = files.get(key)
					return body === undefined ? Option.none() : Option.some(new TextEncoder().encode(body))
				}),
		})
}

const encoder = new TextEncoder()

const toBase64Url = (bytes: ArrayBuffer) =>
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

const signedContent = (location: OrgExportLocation, expiresAt: number) =>
	encoder.encode(`${location.organizationId}/${location.exportId}/${location.parts}/${expiresAt}`)

export class OrgExports extends Context.Service<OrgExports>()("@hazel/backend/OrgExports", {
	make: Effect.gen(function* () {
		const store = yield* OrgExportStore
		const apiBaseUrl = (yield* Config.String("API_BASE_URL")).replace(/\/+$/, "")
		const rootSecret = yield* Config.Redacted("INTEGRATION_ENCRYPTION_KEY")
		const publicUrl = yield* Config.option(Config.String("S3_PUBLIC_URL"))
		const publicUrlBase = Option.map(publicUrl, (url) => url.replace(/\/+$/, ""))

		// HMAC(root secret, label) as the HMAC key: the encryption key itself never signs.
		const signingKey = yield* Effect.promise(async () => {
			const root = await crypto.subtle.importKey(
				"raw",
				encoder.encode(Redacted.value(rootSecret)),
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

		const putPart = (organizationId: string, exportId: string, index: number, body: string) =>
			store.put(orgExportPartKey(organizationId, exportId, index), body)

		/** A URL serving the export's parts as one file until `ORG_EXPORT_URL_TTL_MS` from `now`. */
		const downloadUrl = Effect.fn("OrgExports.downloadUrl")(function* (
			location: OrgExportLocation,
			now: number,
		) {
			const expiresAt = now + ORG_EXPORT_URL_TTL_MS
			const signature = yield* Effect.promise(() =>
				crypto.subtle.sign("HMAC", signingKey, signedContent(location, expiresAt)),
			)
			const query = new URLSearchParams({
				parts: String(location.parts),
				exp: String(expiresAt),
				sig: toBase64Url(signature),
			})
			const path = `${encodeURIComponent(location.organizationId)}/${encodeURIComponent(location.exportId)}`
			return { url: `${apiBaseUrl}/exports/${path}?${query.toString()}`, expiresAt }
		})

		/** The signature is valid and not expired at `now`. */
		const verify = Effect.fn("OrgExports.verify")(function* (
			location: OrgExportLocation,
			expiresAt: number,
			signature: string,
			now: number,
		) {
			if (!Number.isSafeInteger(expiresAt) || expiresAt < now) return false
			if (!Number.isSafeInteger(location.parts) || location.parts < 1) return false
			const bytes = fromBase64Url(signature)
			if (bytes === undefined) return false
			return yield* Effect.promise(() =>
				crypto.subtle.verify("HMAC", signingKey, bytes, signedContent(location, expiresAt)),
			)
		})

		const readPart = (organizationId: string, exportId: string, index: number) =>
			store.read(orgExportPartKey(organizationId, exportId, index))

		/** Where an uploaded attachment is served (`S3_PUBLIC_URL/<id>`), when uploads are public. */
		const attachmentUrl = (attachmentId: string): string | null =>
			Option.match(publicUrlBase, { onNone: () => null, onSome: (base) => `${base}/${attachmentId}` })

		return { putPart, downloadUrl, verify, readPart, attachmentUrl } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
