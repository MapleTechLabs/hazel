// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The `hazel` element vocabulary (contract C1, `docs/hazel-ui.md`): one typed builder per tag in
 * `spec.ts`, runtime tags `hz:*`. Props are plain data from closed sets; slots compile to `hz:slot`
 * children; `attr`, `attrs`, `prop` and `h.el` are closed (types, a throw, and `hazel/no-raw-escape`).
 */
import * as Component from "@effect/ui/Component"
import * as View from "@effect/ui/View"
import { Context, type Effect, type Schema } from "effect"
import type { Platform } from "./options.ts"
import * as Spec from "./spec.ts"
import type { PropSpec, TagKey, Tags } from "./spec.ts"

export type { TagKey, TagName } from "./spec.ts"

/** Runtime tag names by key: `tag.button` is `"hz:button"`. */
export const tag: { readonly [K in TagKey]: `hz:${K}` } = Object.fromEntries(
	Spec.tagKeys.map((key) => [key, Spec.tagName(key)]),
) as never

export const textParents: ReadonlyArray<string> = Spec.textTags

// ---------------------------------------------------------------------------
// types derived from the spec
// ---------------------------------------------------------------------------

type SchemaType<S> = S extends Schema.Top ? S["Type"] : never

/** The typed payload of each event a tag raises. */
export type EventsOf<K extends TagKey> = {
	readonly [E in keyof Tags[K]["events"]]: SchemaType<Tags[K]["events"][E]>
}

type Setter<P, Self> = P extends { readonly kind: "flag" }
	? (on?: boolean) => Self
	: P extends { readonly kind: "option"; readonly schema: infer S }
		? (value: SchemaType<S>) => Self
		: P extends { readonly schema: infer S }
			? (value: SchemaType<S> | undefined) => Self
			: never

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

type ChildInput<Msg, K extends TagKey> = Tags[K]["content"] extends "text"
	? View.Input<Msg, any>
	: Tags[K]["content"] extends "elements"
		? NoTextInput<Msg>
		: never

/** Per-tag methods that are not a prop or a slot: a section's header `action` (an `hz:action` child). */
type Extra<Msg, R, K extends TagKey> = K extends "section"
	? {
			readonly action: (content: NoTextContent<Msg>, message: Msg, label?: string) => Hz<Msg, R, K>
		}
	: {}

type Chain<Msg, R, K extends TagKey> = Extra<Msg, R, K> & {
	readonly [P in keyof Tags[K]["props"]]: Setter<Tags[K]["props"][P], Hz<Msg, R, K>>
} & {
	readonly [S in Tags[K]["slots"][number]]: (...content: ReadonlyArray<NoTextInput<Msg>>) => Hz<Msg, R, K>
}

/** A `hazel` element of tag `K`: its chain methods are its props and slots from `spec.ts`. */
export type Hz<Msg, R, K extends TagKey> = HzBuilder<Msg, R, K> & Chain<Msg, R, K>

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

/** What a setter stores for `value` (`undefined` drops the key: the default). */
const stored = (spec: PropSpec, value: unknown): unknown => {
	switch (spec.kind) {
		case "flag":
			return value === false ? undefined : true
		case "count":
			return value === 0 ? undefined : value
		case "option":
			return value === spec.default ? undefined : value
		default:
			return value
	}
}

/**
 * Every `hz:*` builder. `children` is typed by the tag's `content`; its chain methods are added per
 * tag from `spec.ts` (`builders` below), and typed by `Hz`.
 */
export class HzBuilder<Msg, R, K extends TagKey> extends View.ElementBuilder<
	Msg,
	R,
	EventsOf<K>,
	unknown,
	`hz:${K}`
> {
	override attr(_name: never, _value: never): this {
		throw banned("attributes")
	}
	override attrs(_attributes: never): this {
		throw banned("attributes")
	}
	override prop(_name: never, _value: never): this {
		throw banned("props")
	}
	children<const C extends ReadonlyArray<ChildInput<Msg, K>>>(
		...inputs: C
	): Hz<Msg, R | View.Requirements<C[number]>, K> {
		const key = Spec.keyOf(this.tag)
		const content = key === undefined ? "elements" : Spec.tags[key].content
		if (content === "none") throw new Error(`${this.tag} is a leaf: its content is props, not children`)
		const all = inputs as ReadonlyArray<View.Input<Msg, any>>
		return (
			content === "text" ? View.withContent(this, all) : View.withNoTextContent(this, all, vocabulary)
		) as never
	}
}

const slot = (name: string, content: ReadonlyArray<View.Input<any, any>>) =>
	View.withNoTextContent(
		merge(new HzBuilder<any, never, "slot">(Spec.tagName("slot")), { name }),
		content,
		{
			name: "hazel",
			textParents,
		},
	)

/** One builder per tag, its prototype carrying the tag's setters and slots. */
const builderFor = (key: TagKey): HzBuilder<any, never, TagKey> => {
	class Tag extends HzBuilder<any, never, TagKey> {}
	const props: Readonly<Record<string, PropSpec>> = Spec.tags[key].props
	for (const name of Object.keys(props)) {
		const spec = props[name]!
		Object.defineProperty(Tag.prototype, name, {
			value: function (this: HzBuilder<any, never, TagKey>, value?: unknown) {
				return merge(this, {
					[name]: stored(spec, spec.kind === "flag" && value === undefined ? true : value),
				})
			},
		})
	}
	for (const name of Spec.tags[key].slots) {
		Object.defineProperty(Tag.prototype, name, {
			value: function (
				this: HzBuilder<any, never, TagKey>,
				...content: ReadonlyArray<View.Input<any, any>>
			) {
				return View.withContent(this, [slot(name, content)])
			},
		})
	}
	if (key === "section") {
		Object.defineProperty(Tag.prototype, "action", {
			value: function (
				this: HzBuilder<any, never, TagKey>,
				content: View.Input<any, any>,
				message: unknown,
				label?: string,
			) {
				const action = merge(new HzBuilder<any, never, "action">(Spec.tagName("action")), {
					label,
				}).on("press", message as never)
				return View.withContent(this, [
					View.withNoTextContent(action, [content], { name, textParents }),
				])
			},
		})
	}
	return new Tag(Spec.tagName(key))
}

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

/** `h.extension(def, props)`: an `hz:ext` placeholder with the extension's events and a fallback slot. */
export class HzExtension<out Msg, out R, in out Ev> extends View.ElementBuilder<
	Msg,
	R,
	Ev,
	unknown,
	"hz:ext"
> {
	override attr(_name: never, _value: never): this {
		throw banned("attributes")
	}
	override attrs(_attributes: never): this {
		throw banned("attributes")
	}
	override prop(_name: never, _value: never): this {
		throw banned("props")
	}
	children(..._inputs: ReadonlyArray<never>): this {
		throw new Error("hz:ext takes no children: use .fallback(...)")
	}
	/** What a platform that does not implement it draws, as an `hz:slot` named `fallback`. */
	fallback(...content: ReadonlyArray<NoTextInput<Msg>>): this {
		return View.withContent(this, [
			slot("fallback", content as ReadonlyArray<View.Input<any, any>>),
		]) as this
	}
}

const makeExtension = (definition: AnyExtension, props: unknown) =>
	merge(new HzExtension(Spec.tagName("ext")), { ext: definition.name, args: props })

// ---------------------------------------------------------------------------
// governed composites (`h.custom`, `src/custom/`)
// ---------------------------------------------------------------------------

/**
 * A composite built only from `hazel` primitives (`docs/hazel-ui.md`, "Settled with the user"). Defined
 * in `packages/ui/src/custom/<Name>.ts`, capped by `hazel/custom-cap`; it never takes raw styling.
 */
export interface Composite<out Name extends string, in out P, out Ev extends string> {
	readonly _tag: "HazelComposite"
	readonly name: Name
	readonly props: Schema.Codec<P, any>
	readonly events: ReadonlyArray<Ev>
	readonly view: <Msg>(h: H<Msg>, props: P, on: { readonly [K in Ev]?: Msg }) => NoTextContent<Msg>
}
export type AnyComposite = Composite<string, any, string>

export const composite = <const Name extends string, P, const Ev extends string = never>(options: {
	readonly name: Name
	readonly props: Schema.Codec<P, any>
	readonly events?: ReadonlyArray<Ev>
	readonly view: <Msg>(h: H<Msg>, props: P, on: { readonly [K in Ev]?: Msg }) => NoTextContent<Msg>
}): Composite<Name, P, Ev> => ({
	_tag: "HazelComposite",
	name: options.name,
	props: options.props,
	events: options.events ?? [],
	view: options.view,
})

function makeCustom(
	this: H<unknown>,
	definition: AnyComposite,
	props: unknown,
	on?: Readonly<Record<string, unknown>>,
) {
	return definition.view(this, props, on ?? {})
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

export interface Rect {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

/** Where `scrollTo` goes: an edge, or a keyed child. */
export type ScrollTarget = { readonly to: "start" | "end" } | { readonly key: string }

/**
 * Imperative element operations for Commands (`spec.commandNames`), by `Renderer.Refs` node. The
 * native host sends each as a `command` op and resolves it with Swift's `reply` (lane B).
 */
export class Host extends Context.Service<
	Host,
	{
		readonly focus: (node: unknown) => Effect.Effect<void>
		readonly blur: (node: unknown) => Effect.Effect<void>
		readonly scrollTo: (node: unknown, target: ScrollTarget) => Effect.Effect<void>
		readonly measure: (node: unknown) => Effect.Effect<Rect>
		readonly select: (
			node: unknown,
			range: { readonly start: number; readonly end: number },
		) => Effect.Effect<void>
	}
>()("@hazel/ui/Hazel/Host") {}

// ---------------------------------------------------------------------------
// the vocabulary
// ---------------------------------------------------------------------------

/** Tags a screen names: all but the internal ones (`slot`, `ext`, `action`). */
export type PublicKey = Exclude<TagKey, "slot" | "ext" | "action">

type TagBuilder<Msg, K extends TagKey> = Tags[K]["content"] extends "none"
	? Hz<Msg, never, K>
	: View.Shorthand<Hz<Msg, never, K>>

export type HazelTags<Msg> = { readonly [K in PublicKey]: TagBuilder<Msg, K> } & {
	readonly extension: <D extends AnyExtension>(
		definition: D,
		props: PropsOf<D>,
	) => HzExtension<Msg, never, ExtensionEvents<D>>
	readonly custom: <P, Ev extends string>(
		definition: Composite<string, P, Ev>,
		props: P,
		on?: { readonly [K in Ev]?: Msg },
	) => NoTextContent<Msg>
	/** Closed: a shared screen names only `hazel` tags (`hazel/no-raw-escape` covers runtime). */
	readonly el: never
}

export interface Elements extends View.Elements {
	readonly Tags: HazelTags<this["Msg"]>
	readonly Host: Host
}

/** `h` for reusable `hazel` view functions. */
export type H<Msg> = View.WithTags<Msg, unknown, Elements>

export const Elements: Elements | undefined = undefined
export const name = "hazel"

const tags: Record<string, unknown> = {}
for (const key of Spec.tagKeys) {
	if (key === "slot" || key === "ext" || key === "action") continue
	const builder = builderFor(key)
	tags[key] = Spec.tags[key].content === "none" ? builder : View.shorthand(builder as never)
}
// Installed on the helper's prototype like the builders: `h.extension(def, props)`, `h.custom(def, props)`.
tags.extension = makeExtension
tags.custom = makeCustom

export const vocabulary: View.Vocabulary<Elements> = {
	name,
	tags: tags as never,
	textParents,
}

/** `Component.define` with the `hazel` vocabulary. */
export const component: Component.Define<Elements> = (options) =>
	Component.define({ ...options, elements: vocabulary }) as any
