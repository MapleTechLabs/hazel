/**
 * Root command palette (legacy `components/command-palette` and `atoms/command-palette-state`):
 * the six pages, their live queries and actions. Opened by `RequestedCommandPalette`, the shell's
 * "Browse channels" and the `commandPalette.open` / `search.open` hotkeys.
 */
export { Message, OutMessage } from "./command-palette/message"
export { Model, Page } from "./command-palette/model"
export { subscriptions } from "./command-palette/subscription"
export { init, open, update } from "./command-palette/update"
export { view } from "./command-palette/view"
