import type { LabEntry } from "./define"
import { labPathOfFile } from "./registry"

/**
 * One module per lab page in `./entries/<path>.ts` exporting `lab` (`/lab/customers/kit/badges` is
 * `entries/customers/kit/badges.ts`). Lazy, so lab code never reaches the app's startup bundle.
 */
const entries = import.meta.glob<{ lab: LabEntry }>(["./entries/**/*.ts", "!./entries/**/*.test.ts"])

/** On in dev, and wherever `VITE_HAZEL_LAB=on` (preview deploys). */
export const labEnabled = import.meta.env.DEV || import.meta.env.VITE_HAZEL_LAB === "on"

/** `/lab` → `index`, `/lab/customers/kit/badges` → `customers/kit/badges`, anything else → undefined. */
export const labPathOf = (pathname: string): string | undefined => {
	const match = /^\/lab(?:\/(.+?))?\/?$/.exec(pathname)
	return match === null ? undefined : (match[1] ?? "index")
}

/** Every lab page's URL path, read from the file names without loading any. */
export const labEntryPaths = (): ReadonlyArray<string> => Object.keys(entries).map(labPathOfFile)

/** `?theme=dark|light`, else the system's, as the app's `<html>` class. */
const applyTheme = () => {
	const param = new URLSearchParams(window.location.search).get("theme")
	const theme =
		param === "dark" || param === "light"
			? param
			: window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light"
	document.documentElement.classList.remove("light", "dark")
	document.documentElement.classList.add(theme)
}

export const startLab = (path: string, container: HTMLElement): Promise<void> => {
	applyTheme()
	const load = entries[`./entries/${path}.ts`]
	if (load === undefined) {
		container.textContent = `Unknown lab page: ${path}. Known: ${labEntryPaths().join(", ")}`
		return Promise.resolve()
	}
	return load().then((module) => {
		document.title = `${module.lab.title} · Lab`
		module.lab.start(container)
	})
}
