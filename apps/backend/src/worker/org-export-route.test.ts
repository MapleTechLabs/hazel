/**
 * `GET /exports/...`: streams an export's parts as one file, only for a valid, unexpired signature
 * over the export and its part count.
 */
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { describe, expect, it } from "vitest"
import { OrgExportStore, OrgExports, orgExportPartKey } from "../services/org-exports"
import { OrgExportRoute } from "./org-export-route"

const organizationId = "0b7c8f8e-4a71-4d2e-9a43-0c7c4b0f8a11"
const exportId = "6f1c1b62-3e1f-4f6e-8f0a-9a1d2c3b4e5f"

const setup = () => {
	const files = new Map<string, string>()
	const exports = Layer.effect(OrgExports, OrgExports.make).pipe(
		Layer.provide(OrgExportStore.layerMemory(files)),
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					API_BASE_URL: "http://api.test",
					INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
				}),
			),
		),
	)
	const web = HttpRouter.toWebHandler(OrgExportRoute.pipe(Layer.provide(exports)), { disableLogger: true })
	const fetch = (url: string) => (web.handler as (request: Request) => Promise<Response>)(new Request(url))
	const sign = (parts: number, now = Date.now()) =>
		Effect.runPromise(
			OrgExports.use((service) => service.downloadUrl({ organizationId, exportId, parts }, now)).pipe(
				Effect.provide(exports),
			),
		).then((signed) => signed.url)
	return { files, fetch, sign }
}

describe("OrgExportRoute", () => {
	it("streams every part in order as one NDJSON attachment", async () => {
		const { files, fetch, sign } = setup()
		files.set(orgExportPartKey(organizationId, exportId, 0), '{"table":"export"}\n{"table":"a"}\n')
		files.set(orgExportPartKey(organizationId, exportId, 1), '{"table":"b"}\n')
		files.set(orgExportPartKey(organizationId, exportId, 2), '{"table":"end"}\n')
		const response = await fetch(await sign(3))
		expect(response.status).toBe(200)
		expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8")
		expect(response.headers.get("content-disposition")).toBe(
			`attachment; filename="hazel-export-${exportId}.ndjson"`,
		)
		expect(await response.text()).toBe(
			'{"table":"export"}\n{"table":"a"}\n{"table":"b"}\n{"table":"end"}\n',
		)
	})

	it("refuses a tampered, expired or unsigned link", async () => {
		const { files, fetch, sign } = setup()
		files.set(orgExportPartKey(organizationId, exportId, 0), "{}\n")
		const url = new URL(await sign(1))
		const tampered = new URL(url)
		tampered.searchParams.set("parts", "2")
		expect((await fetch(tampered.toString())).status).toBe(403)
		const expired = await sign(1, Date.now() - 60 * 60 * 1000)
		expect((await fetch(expired)).status).toBe(403)
		const unsigned = new URL(url)
		unsigned.searchParams.delete("sig")
		expect((await fetch(unsigned.toString())).status).toBe(403)
		expect((await fetch(url.toString())).status).toBe(200)
	})

	it("answers 404 for a missing export or a malformed path", async () => {
		const { fetch, sign } = setup()
		expect((await fetch(await sign(1))).status).toBe(404)
		expect((await fetch("http://api.test/exports/nope/nope")).status).toBe(404)
	})
})
