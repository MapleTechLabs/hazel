/**
 * Hazel's RPCs over HTTP: `POST /rpc` with Effect RPC's NDJSON framing, one request per call. The
 * extension's token reaches the Customers read RPCs and `customers.organizations` only.
 */
import { accessToken, SignInRequiredError } from "./auth"
import { apiUrl } from "./config"
import { decodeResponse, RpcError } from "./protocol"

/** The failures that mean the token is no good: refresh, or sign in again. */
const TOKEN_ERRORS = new Set(["InvalidBearerTokenError", "SessionNotProvidedError"])

const send = async <A>(tag: string, payload: unknown, token: string) => {
	const response = await fetch(`${apiUrl()}/rpc`, {
		method: "POST",
		headers: { "content-type": "application/x-ndjson", authorization: `Bearer ${token}` },
		body: `${JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] })}\n`,
	})
	if (!response.ok) throw new RpcError("HttpError", `Hazel answered ${response.status}`)
	return decodeResponse<A>(await response.text())
}

/** Calls `tag`, refreshing the token once if the API refuses it. */
export const call = async <A>(tag: string, payload: unknown, options = { interactive: true }): Promise<A> => {
	try {
		return await send<A>(tag, payload, await accessToken(options))
	} catch (error) {
		if (!(error instanceof RpcError) || !TOKEN_ERRORS.has(error.tag)) throw error
		const token = await accessToken({ ...options, forceRefresh: true }).catch((cause: unknown) => {
			throw cause instanceof SignInRequiredError ? cause : error
		})
		return send<A>(tag, payload, token)
	}
}
