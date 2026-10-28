/**
 * `ObjectStubs` over the api Worker's DO namespaces (`OrgObject`, `ChannelObject`, `UserObject`
 * on the env). Read off the env rather than through the alchemy classes, so the three objects can
 * call each other without a layer cycle; the Worker's init still yields the classes, which binds
 * the namespaces and registers the classes.
 */
import * as Cloudflare from "alchemy/Cloudflare"
import { Layer } from "effect"
import { OBJECT_NAMESPACES } from "./kinds"
import { type ObjectRpc, type ObjectStub, ObjectStubs } from "./protocol"

interface Namespace {
	getByName(name: string): unknown
}

export const workerObjectStubs = (env: Record<string, unknown>): Layer.Layer<ObjectStubs> =>
	Layer.sync(ObjectStubs, () => ({
		get: (target) => {
			const namespace = env[OBJECT_NAMESPACES[target.kind]] as Namespace | undefined
			if (namespace === undefined) {
				throw new Error(`${OBJECT_NAMESPACES[target.kind]} is not bound on this Worker`)
			}
			return Cloudflare.makeRpcStub<ObjectRpc>(namespace.getByName(target.id)) as ObjectStub
		},
	}))
