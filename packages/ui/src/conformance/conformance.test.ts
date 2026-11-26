// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Renderer } from "@effect/ui"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeNativeHost } from "../native/host.ts"
import { Tree } from "../native/tree.ts"
import type { Batch } from "../native/wire.ts"
import { isTagKey, tagKeys, tags } from "../vocabulary/spec.ts"
import { isImplemented } from "../web/primitives.ts"
import { compile } from "./compile.ts"
import { cases, fixtures } from "./fixtures.ts"
import { coverageGaps, nodeProblems, nodesOf, propProblems } from "./validate.ts"
import { FixtureView } from "./view.ts"

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

/** A tree's outline with node ids taken out: structure, props, text and events only. */
const outlineOf = (batches: ReadonlyArray<Batch>) => {
	const tree = new Tree()
	for (const batch of batches) tree.apply(batch)
	return tree.outline().map((line) => line.replace(/#\d+/, ""))
}

/** What the native host really sends for a case's tree, mounted through Effect UI. */
const hosted = (root: (typeof cases)[number]["root"]) => {
	const sent: Array<Batch> = []
	return Effect.gen(function* () {
		const native = makeNativeHost((batch) => sent.push(batch))
		yield* Renderer.mount(FixtureView, { root }, native.container).pipe(Effect.provide(native.layer))
		yield* Effect.promise(settle)
		return [...sent]
	}).pipe(Effect.scoped, Effect.runPromise)
}

describe("conformance fixtures", () => {
	it("exist for every public tag and ext, in a folder named for the tag", () => {
		const folders = new Set(fixtures.map((f) => f.tag))
		const wanted = tagKeys.filter((key) => key !== "slot" && key !== "action")
		expect(wanted.filter((key) => !folders.has(key))).toEqual([])
		expect([...folders].filter((tag) => !isTagKey(tag))).toEqual([])
	})

	it("say only what spec.ts declares, with no defaults", () => {
		const problems = fixtures.flatMap(({ path, fixture }) => {
			const own = nodeProblems(fixture.root).map((p) => `${path}: ${p}`)
			const root = fixture.root.tag
			const axes = isTagKey(root)
				? (fixture.axes ?? []).flatMap((axis) =>
						axis.values
							.filter((value) => value !== null)
							.flatMap((value) =>
								propProblems(root, axis.prop, value).map((p) => `${path}: axis ${p}`),
							),
					)
				: []
			const kit = fixture.kit
			const target =
				kit !== undefined && kit.target !== "frame" && !isTagKey(kit.target)
					? [`${path}: kit target ${kit.target} is neither frame nor a tag`]
					: []
			return [...own, ...axes, ...target]
		})
		expect(problems).toEqual([])
	})

	it("draw their folder's tag in every case", () => {
		const missing = cases
			.filter((c) => !nodesOf(c.root).some((node) => node.tag === c.tag))
			.map((c) => c.id)
		expect(missing).toEqual([])
	})

	it("have unique case ids", () => {
		const ids = cases.map((c) => c.id)
		expect(ids.length).toBe(new Set(ids).size)
	})

	it("compile to exactly what the native host sends (the rule Swift mirrors)", async () => {
		for (const c of cases) {
			const sent = await hosted(c.root)
			expect(outlineOf([compile(c.root)]), c.id).toEqual(outlineOf(sent))
		}
	})

	it("cover every option value and flag of each tag the web draws", () => {
		const gaps = tagKeys
			.filter((key) => tags[key].group !== "internal" && isImplemented(key))
			.flatMap((key) =>
				coverageGaps(
					key,
					cases.filter((c) => c.tag === key),
				).map((gap) => `hz:${key} ${gap}`),
			)
		expect(gaps).toEqual([])
	})
})
