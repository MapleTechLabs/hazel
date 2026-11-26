import type { Attribute, Html, HtmlBuilder } from "foldkit/html"

/**
 * Where a Foldkit view leaves room for an Effect UI screen the shell renders as its own child
 * (`src/root/portal.ts` moves it in). Foldkit leaves the element's children alone. Part of the adapter.
 */
export type HoleName = "channel-sidebar" | "message-list" | "activity" | "dms"

export const HOLE_ATTRIBUTE = "data-hazel-hole"

/** An empty element the shell fills; `key` remounts it, so a switch of org or channel starts fresh. */
export const hole = <Message>(
	h: HtmlBuilder<Message>,
	name: HoleName,
	key: string,
	attributes: ReadonlyArray<Attribute<Message>> = [],
): Html => h.keyed("div")(`hazel-hole:${name}:${key}`, [h.Attribute(HOLE_ATTRIBUTE, name), ...attributes])
