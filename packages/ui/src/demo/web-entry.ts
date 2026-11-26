// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** The browser demo (G1): the same ChannelList the iOS app runs, on the web host, with the spike's fixture. */
import { Effect, Layer } from "effect"
import { sections } from "../../../../apps/ios-hybrid/effect-ui/sections.ts"
import { Renderer } from "@effect/ui"
import { withWebHost } from "../web/mount.ts"
import { installStyles } from "../web/styles.ts"
import { ChannelList } from "./ChannelList.ts"
import { registerDemoWebExtensions } from "./web-extensions.ts"

installStyles(document)
registerDemoWebExtensions()
const app = Renderer.mount(ChannelList, { sections: sections(), tickMs: 0 }, document.getElementById("app")!)
Effect.runFork(Layer.launch(withWebHost(app)))
