import { comboLabel, type Platform } from "~/lib/keybindings/key-combo"

/** A key combo as one label: `⌘K` on a Mac, `Ctrl+K` elsewhere (`key-combo.ts`). */
export const hotkeyLabel = (hotkey: string, platform?: Platform): string => comboLabel(hotkey, platform)
