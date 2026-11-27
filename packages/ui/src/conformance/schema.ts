/**
 * Conformance fixtures (phase 1.5, lane E): one JSON file per case family at
 * `fixtures/<tag>/<name>.json`, a tree of `hazel` nodes with wire props. The web renders them in the
 * browser runner (`scripts/test-web.ts`), Swift in `HazelUITests/SnapshotTests`, and both galleries
 * list them. Every list here is an array, so order survives Swift's unordered JSON dictionaries.
 */
import { Schema } from "effect"

/** A plain JSON value, as a prop crosses the wire. */
export type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json }
export const Json: Schema.Codec<Json> = Schema.suspend(() =>
	Schema.Union([
		Schema.Null,
		Schema.Boolean,
		Schema.Finite,
		Schema.String,
		Schema.Array(Json),
		Schema.Record(Schema.String, Json),
	]),
)

/** A child: a node, or text (only inside a `text`-content tag such as `text` or `heading`). */
export type FixtureChild = FixtureNode | string

export interface FixtureSlot {
	readonly name: string
	readonly children: ReadonlyArray<FixtureChild>
}

/**
 * One node. `tag` is a key from `vocabulary/spec.ts` (internal `action` and `ext` are allowed).
 * `props` are wire props with defaults left out; `events` are the handlers the view attaches.
 * Compile order, the same on both platforms: the node, its `slots` in order (each an `hz:slot`
 * named for it), then `children`.
 */
export interface FixtureNode {
	readonly tag: string
	readonly key?: string
	readonly props?: { readonly [name: string]: Json }
	readonly events?: ReadonlyArray<string>
	readonly slots?: ReadonlyArray<FixtureSlot>
	readonly children?: ReadonlyArray<FixtureChild>
}

const FixtureChild: Schema.Codec<FixtureChild> = Schema.suspend(() =>
	Schema.Union([Schema.String, FixtureNode]),
)

export const FixtureSlot: Schema.Codec<FixtureSlot> = Schema.Struct({
	name: Schema.String,
	children: Schema.Array(FixtureChild),
})

export const FixtureNode: Schema.Codec<FixtureNode> = Schema.Struct({
	tag: Schema.String,
	key: Schema.optional(Schema.String),
	props: Schema.optional(Schema.Record(Schema.String, Json)),
	events: Schema.optional(Schema.Array(Schema.String)),
	slots: Schema.optional(Schema.Array(FixtureSlot)),
	children: Schema.optional(Schema.Array(FixtureChild)),
})

/** One prop of the root varied alone over `values` (each a case); `null` removes the prop. */
export const Axis = Schema.Struct({ prop: Schema.String, values: Schema.Array(Json) })
export type Axis = typeof Axis.Type

/** A named combination of root props, for what one axis at a time cannot show. */
export const NamedCase = Schema.Struct({ name: Schema.String, props: Schema.Record(Schema.String, Json) })
export type NamedCase = typeof NamedCase.Type

/** What the case is drawn inside: a 240pt sidebar column, an inline box, or the full width. */
export const Frame = Schema.Literals(["sidebar", "inline", "screen"])
export type Frame = typeof Frame.Type

/** An element the web case must contain, found by accessible role and name (Playwright `getByRole`). */
export const AriaExpectation = Schema.Struct({ role: Schema.String, name: Schema.optional(Schema.String) })
export type AriaExpectation = typeof AriaExpectation.Type

/**
 * Today's Foldkit kit counterpart in the parity gallery (`gallery/specimens.ts`), for the base case:
 * `specimen` is its `data-specimen` id; `target` is what to shoot on the hazel side (`frame` for the
 * whole frame, or a tag key for its first element).
 */
export const KitCounterpart = Schema.Struct({ specimen: Schema.String, target: Schema.String })
export type KitCounterpart = typeof KitCounterpart.Type

/**
 * Lanes a fixture waits on (contract additions a lane has not drawn yet): each runner skips its cases
 * as "not implemented: lane X" until that lane draws them and deletes its entry.
 */
export const Pending = Schema.Struct({
	web: Schema.optional(Schema.Literals(["A1", "A2", "A3", "A4", "A5"])),
	ios: Schema.optional(Schema.Literals(["S0", "S1", "S2", "S3", "S4", "S5"])),
})
export type Pending = typeof Pending.Type

export const Fixture = Schema.Struct({
	about: Schema.String,
	root: FixtureNode,
	frame: Schema.optional(Frame),
	axes: Schema.optional(Schema.Array(Axis)),
	cases: Schema.optional(Schema.Array(NamedCase)),
	aria: Schema.optional(Schema.Array(AriaExpectation)),
	kit: Schema.optional(KitCounterpart),
	pending: Schema.optional(Pending),
})
export type Fixture = typeof Fixture.Type

/** One drawable case: a fixture with the base props or one axis value or named case applied. */
export interface FixtureCase {
	/** `<tag>/<name>` for the base case, `<tag>/<name>.<prop>-<value>` or `<tag>/<name>.<case>`. */
	readonly id: string
	readonly tag: string
	readonly fixture: string
	readonly root: FixtureNode
	readonly frame: Frame
	readonly aria: ReadonlyArray<AriaExpectation>
	readonly kit: KitCounterpart | undefined
	readonly pending: Pending | undefined
}

const valueLabel = (value: Json): string =>
	value === null ? "none" : typeof value === "string" ? value : JSON.stringify(value)

const withProps = (root: FixtureNode, changes: { readonly [name: string]: Json }): FixtureNode => {
	const props = { ...root.props }
	for (const [name, value] of Object.entries(changes)) {
		if (value === null) delete props[name]
		else props[name] = value
	}
	return { ...root, props }
}

/** Every case of a fixture, in a fixed order: base, each axis value in order, then named cases. */
export const expand = (tag: string, name: string, fixture: Fixture): ReadonlyArray<FixtureCase> => {
	const base = `${tag}/${name}`
	const make = (id: string, root: FixtureNode, kit: KitCounterpart | undefined): FixtureCase => ({
		id,
		tag,
		fixture: name,
		root,
		frame: fixture.frame ?? "screen",
		aria: id === base ? (fixture.aria ?? []) : [],
		kit,
		pending: fixture.pending,
	})
	return [
		make(base, fixture.root, fixture.kit),
		...(fixture.axes ?? []).flatMap((axis) =>
			axis.values.map((value) =>
				make(
					`${base}.${axis.prop}-${valueLabel(value)}`,
					withProps(fixture.root, { [axis.prop]: value }),
					undefined,
				),
			),
		),
		...(fixture.cases ?? []).map((named) =>
			make(`${base}.${named.name}`, withProps(fixture.root, named.props), undefined),
		),
	]
}
