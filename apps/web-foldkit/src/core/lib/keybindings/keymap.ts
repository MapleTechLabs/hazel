import type { Dom } from "foldkit"
import {
	defineKeymap as defineSharedKeymap,
	type ActionSpec,
	type Keys,
} from "@hazel/shared-screens/lib/keybindings/keymap"

export * from "@hazel/shared-screens/lib/keybindings/keymap"

/** How a subscription binds one of its actions; the keys come from the keymap. */
export interface BindingOptions<Output> {
	readonly mapEvent: (event: KeyboardEvent) => Output
	readonly isEnabled?: boolean
	readonly whileTyping?: Dom.WhileTyping
	readonly preventDefault?: boolean
}

/** The shared keymap plus `bindings`, the Foldkit `KeyBinding`s for the ids one subscription owns. */
export const defineKeymap = <const Specs extends Readonly<Record<string, ActionSpec>>>(specs: Specs) => {
	type Id = Extract<keyof Specs, string>
	const keymap = defineSharedKeymap(specs)

	/** Unbound actions are left out. */
	const bindings = <Owned extends Id, Output>(
		keys: Keys<Owned>,
		owned: ReadonlyArray<Owned>,
		options: (id: Owned) => BindingOptions<Output>,
	): ReadonlyArray<Dom.KeyBinding<Output>> =>
		owned.flatMap((id) => {
			const key = keys[id]
			if (key === null) return []
			const { mapEvent, isEnabled, whileTyping, preventDefault } = options(id)
			return [{ keys: key, mapEvent, isEnabled, whileTyping, preventDefault }]
		})

	return { ...keymap, bindings } as const
}
