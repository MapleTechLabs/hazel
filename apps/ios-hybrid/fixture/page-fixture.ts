/**
 * Per-page fixture data for the parity harness: `./pages/<id>.ts` default-exports a `PageFixture`,
 * the file name the page's id in `apps/web-foldkit/src/parity/pages/`. The harness names the page
 * under `PAGE_FIXTURE_KEY`, and the offline build applies only that page's data, so one page's rows
 * never move another's numbers.
 */
import type { FixtureServer } from "./fixture-socket"
import type { Responder } from "./offline-backend"

export interface PageFixture {
	/** Rows written before the app starts, as `server.write(kind, sourceId, table, rows)`. */
	readonly seed?: (server: FixtureServer) => void
	/** RPC answers by tag (encoded success values), over the fixture's own. */
	readonly rpcs?: Readonly<Record<string, Responder>>
	/** The link-preview worker's JSON for a request (`/link-preview`, `/tweet`), over the network's. */
	readonly unfurls?: (url: URL) => object | undefined
	/** A live reply socket's frames by message id (`fixture-socket.ts` `live`). */
	readonly live?: (messageId: string) => ReadonlyArray<object> | undefined
	/** HTTP API answers by path (`makeOfflineFetch`'s `http`). */
	readonly http?: Readonly<Record<string, () => object>>
}

/** The localStorage key naming the page whose fixture the offline build applies. */
export const PAGE_FIXTURE_KEY = "hazel:fixture:page"

const modules = import.meta.glob<{ readonly default: PageFixture }>("./pages/*.ts")

/** The fixture the harness named, if that page has one. */
export const loadPageFixture = async (): Promise<PageFixture | undefined> => {
	let id: string | null = null
	try {
		id = globalThis.localStorage?.getItem(PAGE_FIXTURE_KEY) ?? null
	} catch {
		return undefined
	}
	const load = id === null ? undefined : modules[`./pages/${id}.ts`]
	return load === undefined ? undefined : (await load()).default
}
