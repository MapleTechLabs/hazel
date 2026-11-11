/**
 * Routing hints the api Worker reads to pick the object that owns a row it knows only by id
 * (`apps/backend/src/rpc/routing.ts`). Optional until the client supplies them (the client PR);
 * a call routed by one fails while it is missing. Handlers never write them.
 */
import { ChannelId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"

/** The `ChannelObject` holding the message, reaction, pin, typing indicator or attachment. */
export const RouteChannelId = Schema.optional(ChannelId)

/** The `OrgObject` holding the member, section, webhook, subscription, emoji or chat-sync row. */
export const RouteOrganizationId = Schema.optional(OrganizationId)
