/** `ChannelObject`: one per channel, threads included (DO name = channel id). See `./runtime.ts`. */
import * as Cloudflare from "@alchemy.run/cloudflare"
import { activateObject } from "./activate"
import { OBJECT_NAMESPACES } from "./kinds"
import type { ObjectRpc } from "./protocol"

export class ChannelObject extends Cloudflare.DurableObject<ChannelObject, ObjectRpc>()(
	OBJECT_NAMESPACES.channel,
) {}

export const ChannelObjectLive = ChannelObject.make(activateObject("channel"))
