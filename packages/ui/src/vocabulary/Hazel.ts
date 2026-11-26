// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The `hazel` element vocabulary (G1, `docs/hazel-ui.md`): typed builders whose runtime tags are `hz:*`.
 * Props are plain data from closed sets; slots and actions compile to `hz:slot` / `hz:action` children.
 */
import * as Component from "@effect/ui/Component"
import * as View from "@effect/ui/View"
import { Context, type Schema } from "effect"
import type { IconName, Platform, TextRole, TextTone } from "./options.ts"
import * as TextField from "./TextField.ts"

/** Runtime tag names. */
export const tag = {
	screen: "hz:screen",
	section: "hz:section",
	item: "hz:item",
	text: "hz:text",
	icon: "hz:icon",
	avatar: "hz:avatar",
	slot: "hz:slot",
	action: "hz:action",
	ext: "hz:ext",
	textField: TextField.tag,
} as const
export type Tag = (typeof tag)[keyof typeof tag]

export const textParents = [tag.text] as const

/** The press payload every host builds from its own input (click, tap). */
export interface PressPayload {}

export type EventsOf<T extends string> = T extends typeof tag.item | typeof tag.action
	? { readonly press: PressPayload }
	: {}

// ---------------------------------------------------------------------------
// extensions
// ---------------------------------------------------------------------------

/** A platform extension: declared once, drawn where registered, a fallback elsewhere. */
export interface Extension<
	out Name extends string = string,
	in out P = unknown,
	out Ev extends Readonly<Record<string, Schema.Top>> = Readonly<Record<string, Schema.Top>>,
> {
	readonly _tag: "HazelExtension"
	readonly name: Name
	readonly props: Schema.Codec<P, any>
	readonly events: Ev
	readonly platforms: ReadonlyArray<Platform>
}
export type AnyExtension = Extension<string, any, Readonly<Record<string, Schema.Top>>>
export type PropsOf<D> = D extends Extension<any, infer P, any> ? P : never
export type ExtensionEvents<D> =
	D extends Extension<any, any, infer Ev> ? { readonly [K in keyof Ev]: Ev[K]["Type"] } : never

export const extension = <
	const Name extends string,
	P,
	const Ev extends Readonly<Record<string, Schema.Top>> = {},
>(options: {
	readonly name: Name
	readonly props: Schema.Codec<P, any>
	readonly events?: Ev
	readonly platforms: ReadonlyArray<Platform>
}): Extension<Name, P, Ev> => ({
	_tag: "HazelExtension",
	name: options.name,
	props: options.props,
	events: options.events ?? ({} as Ev),
	platforms: options.platforms,
})

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

const banned = (what: string) =>
	new Error(`hazel elements take no raw ${what}: use the vocabulary's typed props (docs/hazel-ui.md)`)

const merge = <B extends View.ElementBuilder<any, any, any, any>>(
	builder: B,
	props: Readonly<Record<string, unknown>>,
): B => {
	const next: Record<string, unknown> = { ...builder.props }
	for (const key in props) {
		const value = props[key]
		if (value === undefined) delete next[key]
		else next[key] = value
	}
	return View.withFields(builder, { props: next })
}

type NoTextContent<Msg> =
	| View.Element<Msg, any>
	| View.Child<Msg, any>
	| View.Outlet
	| View.ElementBuilder<Msg, any, any, any>
export type NoTextInput<Msg> =
	| NoTextContent<Msg>
	| false
	| null
	| undefined
	| ReadonlyArray<NoTextContent<Msg> | false | null | undefined>

/**
 * Every `hz:*` builder. Chain methods are typed by tag through `this`, as `OpenTui` does; `attr`,
 * `attrs` and `prop` are closed (`never` params at the type level, a throw at runtime).
 */
export class HzElement<
	out Msg,
	out R = never,
	in out E = {},
	out T extends string = string,
> extends View.ElementBuilder<Msg, R, E, unknown, T> {
	override attr(_name: never, _value: never): this {
		throw banned("attributes")
	}
	override attrs(_attributes: never): this {
		throw banned("attributes")
	}
	override prop(_name: never, _value: never): this {
		throw banned("props")
	}

	/** `screen`, `section`, `item`: the title it shows. */
	title(this: HzElement<Msg, R, E, "hz:screen" | "hz:section" | "hz:item">, title: string): this {
		return merge(this, { title }) as this
	}
	/** `item`: a count shown at its end; 0 hides it. */
	badge(this: HzElement<Msg, R, E, "hz:item">, count: number): this {
		return merge(this, { badge: count === 0 ? undefined : count }) as this
	}
	emphasized(this: HzElement<Msg, R, E, "hz:item">, on = true): this {
		return merge(this, { emphasized: on ? true : undefined }) as this
	}
	selected(this: HzElement<Msg, R, E, "hz:item">, on = true): this {
		return merge(this, { selected: on ? true : undefined }) as this
	}
	/** `item`: makes it a link to `url`; without one it is a button. The host swaps inside the item. */
	href(this: HzElement<Msg, R, E, "hz:item">, url: string | undefined): this {
		return merge(this, { href: url }) as this
	}
	/** `item`: what sits before its title (an icon, an avatar), as an `hz:slot` named `leading`. */
	leading(this: HzElement<Msg, R, E, "hz:item">, content: NoTextContent<Msg>): this {
		return View.withContent(this, [slot("leading", content)]) as this
	}
	/** `section`: a header action, as an `hz:action` child holding `content`. */
	action(
		this: HzElement<Msg, R, E, "hz:section">,
		content: NoTextContent<Msg>,
		message: Msg,
		label?: string,
	): this {
		const action = merge(new HzContainer<Msg, never, EventsOf<"hz:action">, "hz:action">(tag.action), {
			label,
		}).on("press", message as never)
		return View.withContent(this, [View.withNoTextContent(action, [content], vocabulary)]) as this
	}
	role(this: HzElement<Msg, R, E, "hz:text">, role: TextRole): this {
		return merge(this, { role: role === "body" ? undefined : role }) as this
	}
	tone(this: HzElement<Msg, R, E, "hz:text">, tone: TextTone): this {
		return merge(this, { tone: tone === "default" ? undefined : tone }) as this
	}
	strong(this: HzElement<Msg, R, E, "hz:text">, on = true): this {
		return merge(this, { strong: on ? true : undefined }) as this
	}
	name(this: HzElement<Msg, R, E, "hz:icon">, name: IconName): this {
		return merge(this, { name }) as this
	}
	initials(this: HzElement<Msg, R, E, "hz:avatar">, initials: string): this {
		return merge(this, { initials }) as this
	}
	/** `extension`: what a platform that does not implement it draws, as an `hz:slot` named `fallback`. */
	fallback(this: HzElement<Msg, R, E, "hz:ext">, content: NoTextContent<Msg>): this {
		return View.withContent(this, [slot("fallback", content)]) as this
	}
}

/** A container: element children only, text goes inside `text`. */
export class HzContainer<out Msg, out R = never, in out E = {}, out T extends string = string> extends HzElement<
	Msg,
	R,
	E,
	T
> {
	children<const C extends ReadonlyArray<NoTextInput<Msg>>>(
		...inputs: C
	): HzContainer<Msg, R | View.Requirements<C[number]>, E, T> {
		return View.withNoTextContent(this, inputs as ReadonlyArray<View.Input<Msg, any>>, vocabulary) as any
	}
}

/** `text`: the only tag that holds text. */
export class HzText<out Msg, out R = never, in out E = {}, out T extends string = string> extends HzElement<
	Msg,
	R,
	E,
	T
> {
	children<const C extends ReadonlyArray<View.Input<Msg, any>>>(
		...inputs: C
	): HzText<Msg, R | View.Requirements<C[number]>, E, T> {
		return View.withContent(this, inputs) as any
	}
}

const slot = <Msg>(name: "leading" | "fallback", content: NoTextContent<Msg>) =>
	View.withNoTextContent(
		merge(new HzContainer<Msg, never, {}, "hz:slot">(tag.slot), { name }),
		[content],
		vocabulary,
	)

// ---------------------------------------------------------------------------
// the vocabulary
// ---------------------------------------------------------------------------

/**
 * Imperative element operations for Commands (focus, scroll, measure). G1 stubs them on both hosts;
 * the wire's `command` op carries them later.
 */
export class Host extends Context.Service<
	Host,
	{
		readonly focus: (node: unknown) => void
		readonly scrollTo: (node: unknown, position: number) => void
	}
>()("@hazel/ui/Hazel/Host") {}

export type Tags<Msg> = {
	readonly screen: View.Shorthand<HzContainer<Msg, never, {}, "hz:screen">>
	readonly section: View.Shorthand<HzContainer<Msg, never, {}, "hz:section">>
	readonly item: View.Shorthand<HzContainer<Msg, never, EventsOf<"hz:item">, "hz:item">>
	readonly text: View.Shorthand<HzText<Msg, never, {}, "hz:text">>
	readonly icon: HzElement<Msg, never, {}, "hz:icon">
	readonly avatar: HzElement<Msg, never, {}, "hz:avatar">
	readonly textField: TextField.HzTextField<Msg>
	readonly extension: <D extends AnyExtension>(
		definition: D,
		props: PropsOf<D>,
	) => HzContainer<Msg, never, ExtensionEvents<D>, "hz:ext">
	/** Closed: a shared screen names only `hazel` tags (the `hazel/no-raw-escape` lint covers runtime). */
	readonly el: never
}

export interface Elements extends View.Elements {
	readonly Tags: Tags<this["Msg"]>
	readonly Host: Host
}

/** `h` for reusable `hazel` view functions. */
export type H<Msg> = View.WithTags<Msg, unknown, Elements>

export const Elements: Elements | undefined = undefined
export const name = "hazel"

const makeExtension = (definition: AnyExtension, props: unknown) =>
	merge(new HzContainer(tag.ext), { ext: definition.name, args: props })

const tags: Readonly<Record<string, View.ElementBuilder<any, any, any, any>>> = {
	screen: View.shorthand(new HzContainer(tag.screen)),
	section: View.shorthand(new HzContainer(tag.section)),
	item: View.shorthand(new HzContainer(tag.item)),
	text: View.shorthand(new HzText(tag.text)),
	icon: new HzElement(tag.icon),
	avatar: new HzElement(tag.avatar),
	textField: TextField.builder,
	// Installed on the helper's prototype like the builders: `h.extension(def, props)`.
	extension: makeExtension as unknown as View.ElementBuilder<any, any, any, any>,
}

export const vocabulary: View.Vocabulary<Elements> = { name, tags, textParents }

/** `Component.define` with the `hazel` vocabulary. */
export const component: Component.Define<Elements> = (options) =>
	Component.define({ ...options, elements: vocabulary }) as any
