import type { Dataset } from "../fixtures/dataset.ts"
import { handleAsset, isAssetRequest, warmAssets } from "./assets.ts"
import { corsHeaders, handleShape } from "./electric.ts"
import { type PushedChange, pushChange } from "./live-events.ts"
import { makeRpcWebHandler, type RpcLog } from "./rpc.ts"

/**
 * One local process that stands in for the whole backend: Effect RPC at `/rpc` on
 * one port, Electric shapes at `/v1/shape` on another. Both frontends are built against this URL, so
 * they can be captured by Playwright or opened side by side in a normal browser.
 */
export const startFixtureBackend = (options: {
	readonly port: number
	readonly electricPort: number
	readonly datasets: ReadonlyMap<string, Dataset>
	readonly defaultDataset: string
}) => {
	const log: RpcLog = { unmocked: new Set() }
	warmAssets(options.datasets.values())
	const rpcHandlers = new Map<string, ReturnType<typeof makeRpcWebHandler>>()
	const rpcFor = (dataset: Dataset) => {
		let handler = rpcHandlers.get(dataset.name)
		if (!handler) {
			handler = makeRpcWebHandler(dataset, log)
			rpcHandlers.set(dataset.name, handler)
		}
		return handler
	}

	const resolveDataset = (request: Request) => {
		const name = request.headers.get("x-parity-dataset") ?? options.defaultDataset
		const dataset = options.datasets.get(name)
		if (!dataset) throw new Error(`ui-parity: unknown dataset "${name}"`)
		return dataset
	}

	const electric = Bun.serve({
		port: options.electricPort,
		idleTimeout: 0,
		async fetch(request) {
			if (request.method === "OPTIONS")
				return new Response(null, { status: 204, headers: corsHeaders(request) })
			if (request.method === "POST" && new URL(request.url).pathname === "/__parity/push") {
				const change: PushedChange = await request.json()
				const seq = pushChange(resolveDataset(request).name, change)
				return Response.json({ seq }, { headers: corsHeaders(request) })
			}
			return handleShape(request, resolveDataset(request))
		},
	})

	const server = Bun.serve({
		port: options.port,
		idleTimeout: 0,
		async fetch(request) {
			const url = new URL(request.url)
			if (request.method === "OPTIONS")
				return new Response(null, { status: 204, headers: corsHeaders(request) })
			if (isAssetRequest(url)) return handleAsset(request, url)

			const dataset = resolveDataset(request)
			if (url.pathname.startsWith("/rpc")) {
				const rpcRequest = new Request(new URL("/rpc", url), request)
				const response = await rpcFor(dataset).handler(rpcRequest)
				const headers = new Headers(response.headers)
				for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value)
				return new Response(response.body, { status: response.status, headers })
			}
			return new Response("not found", { status: 404, headers: corsHeaders(request) })
		},
	})

	return {
		url: `http://localhost:${server.port}`,
		log,
		stop: async () => {
			server.stop(true)
			electric.stop(true)
			await Promise.all([...rpcHandlers.values()].map((handler) => handler.dispose()))
		},
	}
}
