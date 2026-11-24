import { defineMessageUnion } from "foldkit/message"

/** Its rows are links: the router takes them, so the page sends nothing. */
export const Message = defineMessageUnion({
	SwitchedNothing: {},
})
export type Message = typeof Message.Type
