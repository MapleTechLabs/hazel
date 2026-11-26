// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The spike's script (`EffectUiSpike` target), in a bare JavaScriptCore context with no DOM: mounts the
 * `hazel` ChannelList on `@hazel/ui`'s native host and posts each wire batch to Swift (`__native.post`).
 * Swift answers with `__hazel.fire(id, event, payloadJson, seq)`.
 */
import "./jsc-globals"
import { Renderer } from "@effect/ui"
import { Effect } from "effect"
import { ChannelList } from "../../../packages/ui/src/demo/ChannelList.ts"
import { makeNativeHost } from "../../../packages/ui/src/native/host.ts"
import { type Json, WIRE_VERSION } from "../../../packages/ui/src/native/wire.ts"
import { sections } from "./sections"

declare const __native: { post: (json: string) => void }

const native = makeNativeHost((batch) => __native.post(JSON.stringify(batch)))

Effect.gen(function* () {
	yield* Renderer.mount(ChannelList, { sections: sections(), tickMs: 2000 }, native.container)
	return yield* Effect.never
}).pipe(Effect.provide(native.layer), Effect.scoped, Effect.runFork)

Object.assign(globalThis, {
	__hazel: {
		version: WIRE_VERSION,
		fire: (id: number, event: string, payload: string) => native.fire(id, event, JSON.parse(payload) as Json),
	},
})
