/**
 * The AI side panel: chat with an agent, on the member's own T3 Code, about the page they are on.
 * A root Submodel (`aiPanel`), toggled by its nav rail button, `aiPanel.toggle` and the palette.
 */
export { DEFAULT_STORED, loadStored } from "./commands"
export { channelContext, customerContext, routeContextOf } from "./context"
export { Message } from "./message"
export { Model, Stored } from "./model"
export { subscriptions } from "./subscription"
export { close, init, type Inputs, open, toggle, update } from "./update"
export { toggleButton, view, type ViewInputs } from "./view"
