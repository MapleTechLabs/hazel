import type { Runtime } from "foldkit"
import { VIEW_TRANSITION_TYPE } from "../chat/viewer/morph"
import type { Message } from "./message"
import type { Model } from "./model"

/** An image viewer is open on the page: the channel's (messages, threads) or the Files tab's. */
export const isImageViewerOpen = (model: Model): boolean => {
	const page = model.page
	if (page?._tag !== "ChatChannel") return false
	const { overlays, tab } = page.model
	return overlays.open._tag === "ImageViewer" || (tab._tag === "Files" && tab.files.viewerImageId !== null)
}

/**
 * The renders the browser animates: an image viewer opening or closing, so the image morphs
 * between the page and the viewer (`chat/viewer/morph.ts`). Everything else renders plainly.
 */
export const viewTransition: Runtime.ViewTransitionConfig<Model, Message> = ({ previousModel, model }) =>
	isImageViewerOpen(previousModel) !== isImageViewerOpen(model) ? { types: [VIEW_TRANSITION_TYPE] } : false
