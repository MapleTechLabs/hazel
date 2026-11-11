import { definePage } from "../contract"
import { Message } from "./message"
import { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** `/join/$slug`: a public invite link. */
export const page = definePage("Join", { Model, Message }, { routes: ["Join"], init, update, view })
