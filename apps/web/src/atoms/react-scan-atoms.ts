import { Atom } from "effect/reactivity"
import { Schema } from "effect"
import { platformStorageRuntime } from "~/lib/platform-storage"

export const reactScanEnabledAtom = Atom.kvs({
	runtime: platformStorageRuntime,
	key: "react-scan-enabled",
	schema: Schema.toCodecIso(Schema.NullOr(Schema.Boolean)),
	defaultValue: () => false,
})
