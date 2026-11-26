/**
 * The demo's platform extensions (G1): one only iOS draws, one only the web draws. Declared once,
 * used from the shared ChannelList; each platform registers its own implementation.
 */
import { Schema } from "effect"
import { Hazel } from "../vocabulary/index.ts"
import { TokenColor } from "../vocabulary/options.ts"

/** A SwiftUI `MeshGradient` band behind the screen's title (`EffectUiSpike/Extensions.swift`). */
export const MeshBackground = Hazel.extension({
	name: "MeshBackground",
	props: Schema.Struct({ colors: Schema.Array(TokenColor), speed: Schema.Finite }),
	events: { Tapped: Schema.Struct({}) },
	platforms: ["ios"],
})

/** A canvas bar chart of recent activity (`web/extensions.ts`). */
export const ActivityChart = Hazel.extension({
	name: "ActivityChart",
	props: Schema.Struct({ values: Schema.Array(Schema.Finite), color: TokenColor }),
	platforms: ["web"],
})
