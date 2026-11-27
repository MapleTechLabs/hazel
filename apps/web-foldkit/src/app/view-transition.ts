import type { Runtime } from "foldkit"
import { VIEW_TRANSITION_TYPE } from "../chat/viewer/morph"
import type { Message } from "./message"
import type { Model } from "./model"

/** The channel's image viewer (messages, threads) is open; the Files pages' lightbox morphs itself. */
export const isImageViewerOpen = (model: Model): boolean => {
	const page = model.page
	if (page?._tag !== "ChatChannel") return false
	return page.model.overlays.open._tag === "ImageViewer"
}

/**
 * The renders the browser animates: an image viewer opening or closing, so the image morphs
 * between the page and the viewer (`chat/viewer/morph.ts`). Everything else renders plainly.
 */
export const viewTransition: Runtime.ViewTransitionConfig<Model, Message> = ({ previousModel, model }) =>
	isImageViewerOpen(previousModel) !== isImageViewerOpen(model) ? { types: [VIEW_TRANSITION_TYPE] } : false
