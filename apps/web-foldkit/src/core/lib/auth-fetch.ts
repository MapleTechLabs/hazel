/**
 * Authenticated fetch for the Hazel API. In a browser the session is an HttpOnly cookie on
 * the API host, so the request only has to carry credentials (the backend checks the Origin);
 * the desktop app sends its session as a bearer instead.
 */
import { sessionAuthorization } from "./session-bearer"

export const authenticatedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	const authorization = await sessionAuthorization()
	if (authorization === null) return fetch(input, { ...init, credentials: "include" })
	const headers = new Headers(init?.headers)
	headers.set("authorization", authorization)
	return fetch(input, { ...init, headers, credentials: "omit" })
}
