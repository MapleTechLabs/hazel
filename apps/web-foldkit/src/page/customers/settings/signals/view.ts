import { Submodel } from "foldkit"
import type { PageViewInputs } from "../../../contract"
import { editorView } from "./editor-view"
import { listView } from "./list-view"
import type { Message } from "./message"
import type { Model } from "./model"

/** The rules list (with the template picker), or the editor. */
export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	model.editor === null ? listView(h, model, shared) : editorView(h, model, model.editor, shared),
)
