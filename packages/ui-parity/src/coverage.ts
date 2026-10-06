import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { repoRoot } from "./config.ts"
import { scenarios } from "./scenarios.ts"

/**
 * Lists legacy routes that no scenario visits. This is the migration to-do list:
 * a screen is only "ported" once a scenario captures it and the diff is clean.
 */
const DEV_ONLY = /^\/(ui|dev)(\/|$)/

export const uncoveredRoutes = () => {
	const routeTree = readFileSync(resolve(repoRoot, "apps/web/src/routeTree.gen.ts"), "utf8")
	const block = routeTree.match(/interface FileRoutesByFullPath \{([\s\S]*?)\n\}/)?.[1] ?? ""
	const routes = [
		...new Set([...block.matchAll(/'([^']+)':/g)].map((match) => match[1]!.replace(/(.)\/$/, "$1"))),
	]
	const toPattern = (route: string) =>
		new RegExp(`^${route.replace(/\/\$$/, "(/.*)?").replace(/\$[^/]+/g, "[^/]+")}/?$`)
	return routes
		.filter((route) => !DEV_ONLY.test(route))
		.map((route) => ({
			route,
			scenarios: scenarios
				.filter((scenario) => toPattern(route).test(scenario.path))
				.map((scenario) => scenario.id),
		}))
}
