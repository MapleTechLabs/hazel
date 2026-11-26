// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * G7's list and chat tags, on top of `hazel` (same vocabulary name, so the native host takes them).
 * A bench stand-in for the Collections and Chat groups of `docs/hazel-ui.md`: props go through one
 * untyped `set`, which a real vocabulary would replace with typed chain methods.
 */
import * as Component from "@effect/ui/Component"
import * as View from "@effect/ui/View"
import type { Json } from "../native/wire.ts"
import { Hazel } from "../vocabulary/index.ts"

export const chatTag = {
	list: "hz:list",
	listDivider: "hz:listDivider",
	message: "hz:message",
	richText: "hz:richText",
	paragraph: "hz:paragraph",
	codeBlock: "hz:codeBlock",
	run: "hz:run",
	reactionBar: "hz:reactionBar",
	reaction: "hz:reaction",
	attachmentGrid: "hz:attachmentGrid",
	image: "hz:image",
	slot: "hz:slot",
} as const

/** Commands the bench drives the list with, as if data arrived (`new`, `react`) or native asked. */
export type BenchCommand =
	| { readonly kind: "new" }
	| { readonly kind: "react"; readonly id: string }
	| { readonly kind: "older" }

export interface ListEvents {
	readonly reachStart: {}
	/** Option B: the entries native shows, as indices into the whole list. */
	readonly viewport: { readonly first: number; readonly last: number }
	readonly bench: BenchCommand
}

const set = <B extends View.ElementBuilder<any, any, any, any>>(
	builder: B,
	props: Readonly<Record<string, Json | undefined>>,
): B => {
	const next = { ...builder.props }
	for (const key in props) {
		const value = props[key]
		if (value === undefined) delete next[key]
		else next[key] = value
	}
	return View.withFields(builder, { props: next })
}

const textParents = [Hazel.tag.text, chatTag.run, chatTag.codeBlock]

/** An untyped bench element: props through `set`, element children only. */
export class ChatContainer<
	out Msg,
	out R = never,
	in out E = {},
	out T extends string = string,
> extends View.ElementBuilder<Msg, R, E, unknown, T> {
	set(props: Readonly<Record<string, Json | undefined>>): this {
		return set(this, props)
	}
	children<const C extends ReadonlyArray<Hazel.NoTextInput<Msg>>>(
		...inputs: C
	): ChatContainer<Msg, R | View.Requirements<C[number]>, E, T> {
		return View.withNoTextContent(this, inputs as ReadonlyArray<View.Input<Msg, any>>, {
			name: Hazel.name,
			textParents,
		}) as any
	}
}

/** An untyped bench text element (`run`, `codeBlock`). */
export class ChatText<
	out Msg,
	out R = never,
	in out E = {},
	out T extends string = string,
> extends View.ElementBuilder<Msg, R, E, unknown, T> {
	set(props: Readonly<Record<string, Json | undefined>>): this {
		return set(this, props)
	}
	children<const C extends ReadonlyArray<View.Input<Msg, any>>>(
		...inputs: C
	): ChatText<Msg, R | View.Requirements<C[number]>, E, T> {
		return View.withContent(this, inputs) as any
	}
}

interface BenchTags<Msg> {
	readonly list: View.Shorthand<ChatContainer<Msg, never, ListEvents, "hz:list">>
	readonly listDivider: ChatContainer<Msg, never, {}, "hz:listDivider">
	readonly message: View.Shorthand<ChatContainer<Msg, never, {}, "hz:message">>
	readonly slot: View.Shorthand<ChatContainer<Msg, never, {}, "hz:slot">>
	readonly richText: View.Shorthand<ChatContainer<Msg, never, {}, "hz:richText">>
	readonly paragraph: View.Shorthand<ChatContainer<Msg, never, {}, "hz:paragraph">>
	readonly codeBlock: View.Shorthand<ChatText<Msg, never, {}, "hz:codeBlock">>
	readonly run: View.Shorthand<ChatText<Msg, never, {}, "hz:run">>
	readonly reactionBar: View.Shorthand<ChatContainer<Msg, never, {}, "hz:reactionBar">>
	readonly reaction: ChatContainer<Msg, never, {}, "hz:reaction">
	readonly attachmentGrid: View.Shorthand<ChatContainer<Msg, never, {}, "hz:attachmentGrid">>
	readonly image: ChatContainer<Msg, never, {}, "hz:image">
}

/** G7's tags over the vocabulary's: the bench's untyped stand-ins win where the names meet. */
export type ChatTags<Msg> = Omit<Hazel.HazelTags<Msg>, keyof BenchTags<Msg>> & BenchTags<Msg>

export interface ChatElements extends View.Elements {
	readonly Tags: ChatTags<this["Msg"]>
	readonly Host: Hazel.Host
}

export type H<Msg> = View.WithTags<Msg, unknown, ChatElements>

const tags = {
	...Hazel.vocabulary.tags,
	list: View.shorthand(new ChatContainer(chatTag.list)),
	listDivider: new ChatContainer(chatTag.listDivider),
	message: View.shorthand(new ChatContainer(chatTag.message)),
	slot: View.shorthand(new ChatContainer(chatTag.slot)),
	richText: View.shorthand(new ChatContainer(chatTag.richText)),
	paragraph: View.shorthand(new ChatContainer(chatTag.paragraph)),
	codeBlock: View.shorthand(new ChatText(chatTag.codeBlock)),
	run: View.shorthand(new ChatText(chatTag.run)),
	reactionBar: View.shorthand(new ChatContainer(chatTag.reactionBar)),
	reaction: new ChatContainer(chatTag.reaction),
	attachmentGrid: View.shorthand(new ChatContainer(chatTag.attachmentGrid)),
	image: new ChatContainer(chatTag.image),
}

export const vocabulary: View.Vocabulary<ChatElements> = {
	name: Hazel.name,
	tags,
	textParents,
}

export const component: Component.Define<ChatElements> = (options) =>
	Component.define({ ...options, elements: vocabulary }) as any
