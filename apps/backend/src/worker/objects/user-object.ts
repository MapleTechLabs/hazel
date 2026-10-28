/** `UserObject`: one per user (DO name = user id). See `./runtime.ts`. */
import * as Cloudflare from "alchemy/Cloudflare"
import { activateObject } from "./activate"
import { OBJECT_NAMESPACES } from "./kinds"
import type { ObjectRpc } from "./protocol"

export class UserObject extends Cloudflare.DurableObject<UserObject, ObjectRpc>()(OBJECT_NAMESPACES.user) {}

export const UserObjectLive = UserObject.make(activateObject("user"))
