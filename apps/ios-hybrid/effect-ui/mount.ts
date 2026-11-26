// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Mounts the channel list on the native host (spike). `Html.Host` holds the element operations
 * Commands use (focus, measure...): none run on this screen yet, so they refuse.
 */
import { Renderer } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Effect, Layer } from "effect"
import { ChannelList, type Section } from "./ChannelList"
import { makeNativeHost, type Op } from "./native-host"

const unsupported: Html.Host["Service"] = {
	focus: () => {},
	blur: () => {},
	scrollIntoView: () => {},
	measure: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }),
	select: () => {},
	requestSubmit: () => false,
	showPicker: () => false,
}

export const mountChannelList = (
	props: { readonly sections: ReadonlyArray<Section>; readonly tickMs: number },
	send: (ops: ReadonlyArray<Op>) => void,
) => {
	const native = makeNativeHost(send)
	const layer = Layer.mergeAll(Renderer.layer(native.host), Layer.succeed(Html.Host, unsupported))
	return Renderer.mount(ChannelList, props, native.container).pipe(Effect.as(native), Effect.provide(layer))
}
