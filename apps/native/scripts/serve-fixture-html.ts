/**
 * Serves a page as the api serves an HTML render, for the iOS Simulator's offline fixture, whose
 * runtime cannot serve one itself:
 *
 *   bun scripts/serve-fixture-html.ts page.html [port]
 *   HAZEL_FIXTURE_HTML=<the URL it prints> bun run ios --install booted
 *
 * The file is read on every load, so an edit shows when the app reloads the render.
 */
import { resolve } from "node:path"
import { serveFixtureHtml } from "../src/fixture/html-render"

const [file, port] = process.argv.slice(2)
if (file === undefined) throw new Error("usage: bun scripts/serve-fixture-html.ts <page.html> [port]")
const { url } = await serveFixtureHtml(resolve(file), port === undefined ? 4310 : Number(port))
console.log(url)
