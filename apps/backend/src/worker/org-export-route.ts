/**
 * `GET /exports/:organizationId/:exportId?parts=<n>&exp=<ms>&sig=<sig>`: an organization data
 * export, for the URL `organizationExport.downloadUrl` signed (`services/org-exports.ts`). The
 * signature is the only check, so the link works from a plain browser download. The parts are
 * streamed one after another as a single NDJSON file, one part in memory at a time.
 */
import { Clock, Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { OrgExports } from "../services/org-exports"

const EXPORT_PATH = /^\/exports\/([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})$/

const notFound = () => HttpServerResponse.text("Not found", { status: 404 })

export const OrgExportRoute = HttpRouter.use((router) =>
	Effect.gen(function* () {
		// Resolved when the route is built: a handler only sees the request's own services.
		const exports = yield* OrgExports
		return yield* router.add(
			"GET",
			"/exports/*",
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const url = new URL(request.url, "http://localhost")
				const [, organizationId, exportId] = EXPORT_PATH.exec(url.pathname) ?? []
				if (organizationId === undefined || exportId === undefined) return notFound()
				const location = {
					organizationId: organizationId.toLowerCase(),
					exportId: exportId.toLowerCase(),
					parts: Number(url.searchParams.get("parts")),
				}
				const expiresAt = Number(url.searchParams.get("exp"))
				const now = yield* Clock.currentTimeMillis
				const valid = yield* exports.verify(
					location,
					expiresAt,
					url.searchParams.get("sig") ?? "",
					now,
				)
				if (!valid) return HttpServerResponse.text("Link expired", { status: 403 })

				// The first part is read up front: a missing file answers 404, not an empty download.
				const first = yield* exports.readPart(location.organizationId, location.exportId, 0)
				if (Option.isNone(first)) return notFound()
				const context = yield* Effect.context<never>()
				const readPart = (index: number) =>
					Effect.runPromiseWith(context)(
						exports
							.readPart(location.organizationId, location.exportId, index)
							.pipe(Effect.map(Option.getOrUndefined)),
					)
				// One part (a few MB) in memory at a time; the next is read when the client wants it.
				let index = 0
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(first.value)
					},
					async pull(controller) {
						index += 1
						if (index >= location.parts) {
							controller.close()
							return
						}
						const next = await readPart(index)
						if (next === undefined) {
							controller.error(new Error(`Export part ${index} is missing`))
							return
						}
						controller.enqueue(next)
					},
				})
				return HttpServerResponse.fromWeb(
					new Response(body, {
						headers: {
							"Content-Type": "application/x-ndjson; charset=utf-8",
							"Content-Disposition": `attachment; filename="hazel-export-${location.exportId}.ndjson"`,
							"X-Content-Type-Options": "nosniff",
							"Referrer-Policy": "no-referrer",
							"Cache-Control": "private, no-store",
						},
					}),
				)
			}).pipe(
				Effect.catchTag("OrgExportStoreError", (error) =>
					Effect.logError("Could not read an organization export", { error: error.message }).pipe(
						Effect.as(HttpServerResponse.text("Unavailable", { status: 503 })),
					),
				),
				Effect.withSpan("OrgExportRoute.serve"),
			),
		)
	}),
)
