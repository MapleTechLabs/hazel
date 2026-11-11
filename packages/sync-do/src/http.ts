import { HttpBody, HttpServerResponse } from "effect/http"

/**
 * Wrap `acceptSocket`'s raw `101` for an `effect/http` handler (alchemy's object `fetch`), the way
 * alchemy's own `Cloudflare.upgrade` does: the raw response, its `webSocket` and the echoed
 * subprotocol pass through untouched.
 */
export const toHttpServerResponse = (response: Response): HttpServerResponse.HttpServerResponse =>
	HttpServerResponse.setBody(HttpServerResponse.empty({ status: 101 }), HttpBody.raw(response))
