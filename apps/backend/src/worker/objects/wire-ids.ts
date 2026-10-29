/**
 * Ids as they cross between objects. These come from rows already stored, which are trusted, and
 * not every stored id is an RFC 4122 UUID (the Linear bot's id is generated deterministically), so
 * the wire keeps the brand but skips the format check the request-facing `@hazel/schema` ids run.
 */
import type { BotId } from "@hazel/schema"
import { Schema } from "effect"

export const StoredBotId: Schema.Codec<BotId, string> = Schema.String.pipe(Schema.brand("@HazelChat/BotId"))
