/**
 * What a fixture may say (phase 1.5): only tags, props, slots and events `spec.ts` declares, values
 * its schemas accept, and no defaults (a host never sends them, so Swift's compile would differ).
 */
import { Schema } from "effect"
import { isTagKey, type PropSpec, type TagKey, tags } from "../vocabulary/spec.ts"
import type { FixtureCase, FixtureChild, FixtureNode, Json } from "./schema.ts"

const isDefault = (spec: PropSpec, value: Json) =>
	(spec.kind === "flag" && value === false) ||
	(spec.kind === "count" && value === 0) ||
	(spec.kind === "option" && value === spec.default)

/** Problems with one prop value, or none. */
export const propProblems = (key: TagKey, name: string, value: Json): ReadonlyArray<string> => {
	const props: Readonly<Record<string, PropSpec>> = tags[key].props
	const spec = props[name]
	if (spec === undefined) return [`hz:${key} has no prop ${name}`]
	if (isDefault(spec, value))
		return [`hz:${key}.${name} is its default (${JSON.stringify(value)}): leave it out`]
	// SAFETY: spec schemas are plain data codecs with no decoding services (`spec.ts` builds them so).
	const schema = spec.schema as Schema.Codec<unknown>
	const decoded = Schema.decodeUnknownExit(schema)(value)
	return decoded._tag === "Success" ? [] : [`hz:${key}.${name} = ${JSON.stringify(value)} does not decode`]
}

export const nodeProblems = (node: FixtureNode, at = "root"): ReadonlyArray<string> => {
	if (!isTagKey(node.tag)) return [`${at}: unknown tag ${node.tag}`]
	const key = node.tag
	const spec = tags[key]
	const problems: Array<string> = []
	for (const [name, value] of Object.entries(node.props ?? {}))
		problems.push(...propProblems(key, name, value).map((p) => `${at}: ${p}`))
	const events: Readonly<Record<string, unknown>> = spec.events
	for (const event of node.events ?? [])
		if (!Object.hasOwn(events, event)) problems.push(`${at}: hz:${key} raises no ${event}`)
	const slotNames: ReadonlyArray<string> = spec.slots
	for (const slot of node.slots ?? [])
		if (!slotNames.includes(slot.name)) problems.push(`${at}: hz:${key} has no slot ${slot.name}`)
	const children = node.children ?? []
	if (spec.content === "none" && children.length > 0) problems.push(`${at}: hz:${key} is a leaf`)
	if (spec.content === "elements" && children.some((c) => typeof c === "string"))
		problems.push(`${at}: hz:${key} takes no text (wrap it in a text tag)`)
	const walk = (list: ReadonlyArray<FixtureChild>, where: string) =>
		list.forEach((c, i) => {
			if (typeof c !== "string") problems.push(...nodeProblems(c, `${where}[${i}]`))
		})
	for (const slot of node.slots ?? []) walk(slot.children, `${at}.${slot.name}`)
	walk(children, `${at}.children`)
	return problems
}

/** Every node of a case's tree, depth first. */
export const nodesOf = (root: FixtureNode): ReadonlyArray<FixtureNode> => {
	const out: Array<FixtureNode> = []
	const visit = (node: FixtureNode) => {
		out.push(node)
		for (const slot of node.slots ?? [])
			for (const c of slot.children) if (typeof c !== "string") visit(c)
		for (const c of node.children ?? []) if (typeof c !== "string") visit(c)
	}
	visit(root)
	return out
}

/**
 * What the gallery must show for a tag: every non-default option value and every flag, set on that
 * tag somewhere in its own cases. Returns what is missing, as `prop=value`.
 */
export const coverageGaps = (key: TagKey, own: ReadonlyArray<FixtureCase>): ReadonlyArray<string> => {
	const seen = new Set<string>()
	for (const c of own)
		for (const node of nodesOf(c.root))
			if (node.tag === key)
				for (const [name, value] of Object.entries(node.props ?? {}))
					seen.add(`${name}=${String(value)}`)
	const wanted: Array<string> = []
	const props: Readonly<Record<string, PropSpec>> = tags[key].props
	for (const [name, spec] of Object.entries(props)) {
		if (spec.kind === "flag") wanted.push(`${name}=true`)
		if (spec.kind === "option") {
			const schema = spec.schema
			const literals = "literals" in schema && Array.isArray(schema.literals) ? schema.literals : []
			for (const value of literals) if (value !== spec.default) wanted.push(`${name}=${String(value)}`)
		}
	}
	return wanted.filter((entry) => !seen.has(entry))
}
