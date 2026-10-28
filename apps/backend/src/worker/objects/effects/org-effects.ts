/**
 * Effects an `OrgObject` receives. None yet; the porting work adds, per
 * `infra/durable-object-sync-plan.md` §4:
 *
 * - from `ChannelObject` message writes: the channel's `lastMessageAt`, `notificationCount`
 *   increments, mention resolution;
 * - from `UserObject` presence and directory profile updates: the `users` and
 *   `user_presence_status` projections;
 * - chat-sync and Connect host-side updates.
 */
import type { Database } from "@hazel/db"
import type { EffectReceivers } from "./registry"

export const OrgEffects = {}

export const orgReceivers = {} satisfies EffectReceivers<typeof OrgEffects, Database.Database>
