import { definePage } from "../contract"
import { Message } from "./message"
import { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** `/invite/$token`: the link in an invitation email. */
export const page = definePage("Invite", { Model, Message }, { routes: ["Invite"], init, update, view })
