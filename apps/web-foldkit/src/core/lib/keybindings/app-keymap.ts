import { appKeymapSpecs } from "@hazel/shared-screens/lib/keybindings/app-keymap"
import { defineKeymap } from "./keymap"

export * from "@hazel/shared-screens/lib/keybindings/app-keymap"

// The shared keymap, with the Foldkit `bindings` the layout and channel hotkeys use.
export const appKeymap = defineKeymap(appKeymapSpecs)
