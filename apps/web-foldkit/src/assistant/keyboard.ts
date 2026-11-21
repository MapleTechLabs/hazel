/**
 * Whether a key event comes from inside the AI panel (its desktop column or its phone sheet, both
 * marked `data-ai-panel`): page hotkeys leave those keys to the panel, so typing in its composer never
 * opens a page's picker or marks a channel read.
 */
export const isInAssistantPanel = (target: EventTarget | null): boolean =>
	typeof Element !== "undefined" && target instanceof Element && target.closest("[data-ai-panel]") !== null
