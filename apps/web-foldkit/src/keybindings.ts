import { Effect, Option, Schema } from "effect"
import { appKeymap } from "~/lib/keybindings/app-keymap"
import { type Overrides, StoredOverrides } from "~/lib/keybindings/keymap"
import { readStored, writeStored } from "./data/storage"

/**
 * The user's keybinding overrides, owned by the root (`Shared.keys` is them resolved). Stored per
 * device, like the sound settings: a desktop and a laptop keyboard often want different keys.
 */

const KEYBINDINGS_KEY = "keybinding-overrides"
const StoredCodec = Schema.toCodecIso(Schema.NullOr(StoredOverrides))

export const loadKeybindingOverrides: Effect.Effect<Overrides> = readStored(
	KEYBINDINGS_KEY,
	StoredCodec,
).pipe(Effect.map((stored) => appKeymap.clean(Option.getOrNull(stored) ?? {})))

export const saveKeybindingOverrides = (overrides: Overrides) =>
	writeStored(KEYBINDINGS_KEY, StoredCodec, overrides)
