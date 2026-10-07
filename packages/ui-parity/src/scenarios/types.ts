import type { Page } from "playwright"
import type { Dataset } from "../fixtures/dataset.ts"
import { defaultIds } from "../fixtures/datasets/default.ts"

/**
 * A scenario is one screen state, captured identically in both apps.
 *
 * Steps drive the page with accessible locators (`getByRole`, `getByText`), never
 * CSS selectors or test IDs, so the same script runs against the React app and
 * the Foldkit app. If a step cannot find its element in one app, that is itself a
 * parity failure (wrong role, missing label) and is reported as such.
 */
export interface Scenario {
	readonly id: string
	readonly title: string
	readonly path: string
	readonly dataset?: string
	readonly viewports?: ReadonlyArray<ViewportName>
	readonly themes?: ReadonlyArray<ThemeName>
	readonly steps?: (page: Page) => Promise<void>
	/** Elements whose pixels are excluded from the diff (e.g. a live clock). Accessible locators only. */
	readonly mask?: (page: Page) => ReadonlyArray<ReturnType<Page["locator"]>>
	/** Capture the full scroll height instead of the viewport. */
	readonly fullPage?: boolean
	/** Tag for grouping in the report and for `--filter`. */
	readonly area: string
}

export const viewports = {
	desktop: { width: 1440, height: 900 },
	laptop: { width: 1280, height: 800 },
	mobile: { width: 390, height: 844 },
} as const
export type ViewportName = keyof typeof viewports

export type ThemeName = "light" | "dark"

export type RpcHandlers = Readonly<Record<string, (payload: unknown) => unknown>>

/**
 * One file per area (`src/scenarios/<area>.ts`), aggregated by `src/scenarios.ts`, so parallel
 * work on different areas never edits the same file. An area owns its scenarios, the datasets it
 * introduces, and canned RPCs its screens need on every dataset.
 */
export interface AreaModule {
	readonly scenarios: ReadonlyArray<Scenario>
	readonly datasets?: ReadonlyArray<Dataset>
	/** Merged over the built-in handlers in `backend/rpc.ts`; a dataset's own `rpc` still wins. */
	readonly rpc?: (dataset: Dataset) => RpcHandlers
}

export const org = `/${defaultIds.orgSlug}`
export const chat = (key: Parameters<typeof defaultIds.channel>[0]) => `${org}/chat/${defaultIds.channel(key)}`
