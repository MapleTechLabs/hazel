/** `OrgObject`: one per organization (DO name = organization id). See `./runtime.ts`. */
import * as Cloudflare from "@alchemy.run/cloudflare"
import { activateObject } from "./activate"
import { OBJECT_NAMESPACES } from "./kinds"
import type { ObjectRpc } from "./protocol"

export class OrgObject extends Cloudflare.DurableObject<OrgObject, ObjectRpc>()(OBJECT_NAMESPACES.org) {}

export const OrgObjectLive = OrgObject.make(activateObject("org"))
