import { HazelAuthApi } from "@hazel/auth/contract"
import { Client } from "@yielded/auth"
import { Layer } from "effect"
import type { ClientService } from "@yielded/auth/Client"

/**
 * Hazel's sign-in client (`@hazel/auth/contract` over `/auth/*` on the API). The session is
 * an HttpOnly cookie on the API host; the client sends credentials and the CSRF header.
 */
export const HazelAuthClient = Client.make(HazelAuthApi, {
	baseUrl: import.meta.env.VITE_BACKEND_URL || "http://localhost:3003",
})

export type HazelAuthClient = ClientService<typeof HazelAuthApi.namespace, typeof HazelAuthApi.actions>

/** Construction only fails on an invalid client configuration, a programming error. */
export const HazelAuthClientLive = HazelAuthClient.layerFetch.pipe(Layer.orDie)

/** Sign-in providers the API offers; Google is configured per stage. */
export const Provider = ["github", "google"] as const
export type Provider = (typeof Provider)[number]

export const isProvider = (value: string): value is Provider =>
	(Provider as ReadonlyArray<string>).includes(value)
