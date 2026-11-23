/** What the OAuth broker and its instances exchange, shared by both sides. */
import { Schema } from "effect"

/** Headers of the broker's own signed requests (relayed webhooks, refresh requests). */
export const BROKER_HEADERS = {
	instance: "x-hazel-broker-instance",
	timestamp: "x-hazel-broker-timestamp",
	signature: "x-hazel-broker-signature",
	event: "x-hazel-broker-event",
	delivery: "x-hazel-broker-delivery",
} as const

/** The tokens a sealed `connect` or `refresh` payload carries. */
export const BrokeredTokens = Schema.Struct({
	accessToken: Schema.String,
	refreshToken: Schema.optional(Schema.String),
	/** Epoch milliseconds. */
	expiresAt: Schema.optional(Schema.Finite),
	scope: Schema.optional(Schema.String),
	tokenType: Schema.String,
})
export type BrokeredTokens = typeof BrokeredTokens.Type

export const ConnectData = Schema.Struct({
	tokens: BrokeredTokens,
	/** The GitHub App installation, for a `github` connection. */
	installationId: Schema.optional(Schema.String),
})
export type ConnectData = typeof ConnectData.Type
