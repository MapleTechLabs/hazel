/// <reference types="vite/client" />
/**
 * Every fixture, found by file glob (`fixtures/<tag>/<name>.json`), so a lane adds one without editing
 * a shared list. Vite and Vitest only; Swift reads the same folder (`ConformanceFixtures.load`).
 */
import { Schema } from "effect"
import { expand, Fixture, type FixtureCase } from "./schema.ts"

const files = import.meta.glob<unknown>("./fixtures/*/*.json", { eager: true, import: "default" })

export interface LoadedFixture {
	readonly path: string
	readonly tag: string
	readonly name: string
	readonly fixture: Fixture
}

const decode = Schema.decodeUnknownSync(Fixture)

export const fixtures: ReadonlyArray<LoadedFixture> = Object.entries(files)
	.map(([path, json]) => {
		const [, tag = "", file = ""] = /^\.\/fixtures\/([^/]+)\/([^/]+)\.json$/.exec(path) ?? []
		return { path, tag, name: file, fixture: decode(json) }
	})
	.sort((a, b) => (a.path < b.path ? -1 : 1))

export const cases: ReadonlyArray<FixtureCase> = fixtures.flatMap(({ tag, name, fixture }) =>
	expand(tag, name, fixture),
)
