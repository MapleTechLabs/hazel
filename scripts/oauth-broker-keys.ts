#!/usr/bin/env bun
/**
 * Keys for the OAuth broker on Hazel's own install (`docs/self-hosting.md#brokered-integrations`):
 *
 *   bun scripts/oauth-broker-keys.ts
 *
 * Prints `OAUTH_BROKER_STATE_KEY` (HMAC key for the broker's OAuth state) and
 * `OAUTH_BROKER_SIGNING_KEY` (the ECDSA P-256 key that signs sealed tokens and relayed webhooks) for
 * the broker's secrets, and `OAUTH_BROKER_PUBLIC_KEY`, the public half every customer instance
 * pins. Rotating the signing key means handing every instance the new public key.
 */
import { generateBrokerSigningKey, generateStateKey } from "../apps/backend/src/services/oauth-broker/crypto"

const signing = await generateBrokerSigningKey()

console.log("# Broker secrets (Hazel's own install). Keep them out of git.")
console.log(`OAUTH_BROKER_STATE_KEY=${generateStateKey()}`)
console.log(`OAUTH_BROKER_SIGNING_KEY='${JSON.stringify(signing.privateKey)}'`)
console.log("")
console.log("# Public: give it to every customer instance (their OAUTH_BROKER_PUBLIC_KEY).")
console.log(`OAUTH_BROKER_PUBLIC_KEY='${JSON.stringify(signing.publicKey)}'`)
