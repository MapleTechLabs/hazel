/**
 * Whether the org uses Customers: set once its customers object pulled the members
 * (`customer-members.ts`). A leaf module, so the chat relay can read it without importing the
 * members sync (which reaches the effect registries).
 */
import { Effect, Option } from "effect"
import { readObjectMeta } from "../meta"

export const CUSTOMERS_ENABLED_KEY = "customersEnabled"

export const isCustomersEnabled = Effect.map(readObjectMeta(CUSTOMERS_ENABLED_KEY), Option.isSome)
