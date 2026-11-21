/**
 * The AI side panel: chat with an agent, on the member's own T3 Code, about the page they are on.
 * A root Submodel (`aiPanel`), toggled by its nav rail button, `aiPanel.toggle` and the palette.
 */
export { loadStored } from "./commands"
export { routeContextOf } from "./context"
export { Message } from "./message"
export { Model, Stored } from "./model"
export { subscriptions } from "./subscription"
export { init, type Inputs, open, toggle, update } from "./update"
export { toggleButton, view } from "./view"
