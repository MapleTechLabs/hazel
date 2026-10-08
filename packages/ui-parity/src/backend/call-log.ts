/**
 * Behavioral parity: every RPC and HTTP API request the fixture backend receives, keyed by the
 * capture that sent it (the `x-parity-capture` header `capture.ts` adds). `compare.ts` diffs the
 * logs of the two apps.
 */

export interface RecordedCall {
	readonly kind: "rpc" | "http"
	/** RPC tag (`message.create`) or `METHOD /path`. */
	readonly name: string
	/** Encoded RPC payload, or the parsed (else raw) HTTP body; `null` when there is none. */
	readonly payload: unknown
}

export const CAPTURE_HEADER = "x-parity-capture"
/** `GET` returns and forgets a capture's calls, `DELETE` forgets them (stragglers after the capture). */
export const CALL_LOG_PATH = "/__parity/calls"

const parseBody = (text: string): unknown => {
	if (!text) return null
	try {
		return JSON.parse(text)
	} catch {
		return text
	}
}

export const makeCallLog = () => {
	const byCapture = new Map<string, RecordedCall[]>()
	const push = (capture: string, call: RecordedCall) => {
		const calls = byCapture.get(capture) ?? []
		calls.push(call)
		byCapture.set(capture, calls)
	}

	/** RPC bodies are NDJSON client messages; only `Request` messages are calls. */
	const recordRpc = async (request: Request) => {
		const capture = request.headers.get(CAPTURE_HEADER)
		if (!capture || request.method !== "POST") return
		for (const line of (await request.clone().text()).split("\n")) {
			if (!line.trim()) continue
			const message = parseBody(line) as { _tag?: string; tag?: string; payload?: unknown }
			if (message?._tag === "Request" && message.tag)
				push(capture, { kind: "rpc", name: message.tag, payload: message.payload ?? null })
		}
	}

	const recordHttp = async (request: Request, url: URL) => {
		const capture = request.headers.get(CAPTURE_HEADER)
		if (!capture) return
		const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text()
		push(capture, {
			kind: "http",
			name: `${request.method} ${url.pathname}${url.search}`,
			payload: parseBody(body),
		})
	}

	/** Serves `CALL_LOG_PATH`; returns undefined for any other request. */
	const handle = (request: Request, url: URL): Response | undefined => {
		if (url.pathname !== CALL_LOG_PATH) return undefined
		const capture = url.searchParams.get("capture") ?? ""
		const calls = byCapture.get(capture) ?? []
		byCapture.delete(capture)
		return Response.json(request.method === "GET" ? calls : [])
	}

	return { recordRpc, recordHttp, handle }
}
