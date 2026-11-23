/**
 * Prints Hazel's Slack app manifest (`apps/backend/slack-app-manifest.yaml`, the template) for an
 * install's api host: every `https://api.hazel.sh` URL in it becomes `--api-url`. Paste the output
 * into https://api.slack.com/apps → "Create New App" → "From a manifest".
 *
 *   bun run slack:manifest --api-url https://api.chat.acme.com
 *   bun run slack:manifest --api-url https://api.chat.acme.com --name "Acme Chat"
 */
import { resolve } from "node:path"
import { parseArgs } from "node:util"

const TEMPLATE = resolve(import.meta.dir, "../apps/backend/slack-app-manifest.yaml")
const TEMPLATE_API_URL = "https://api.hazel.sh"

const usage = "Usage: bun run slack:manifest --api-url https://api.<zone> [--name <app name>]"

const fail = (message: string): never => {
	console.error(`${message}\n${usage}`)
	process.exit(1)
}

const { values } = parseArgs({
	options: {
		"api-url": { type: "string" },
		name: { type: "string" },
		help: { type: "boolean", short: "h" },
	},
})

if (values.help) {
	console.log(usage)
	process.exit(0)
}

const rawUrl = values["api-url"] ?? fail("--api-url is required")
let apiUrl: URL
try {
	apiUrl = new URL(rawUrl)
} catch {
	apiUrl = fail(`--api-url "${rawUrl}" is not a URL`)
}
// Slack only delivers events and OAuth redirects to https.
if (apiUrl.protocol !== "https:") fail("--api-url must be https")
if (apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash) fail("--api-url is an origin, without a path")

let manifest = (await Bun.file(TEMPLATE).text()).replaceAll(TEMPLATE_API_URL, apiUrl.origin)
if (values.name) {
	// The app and bot names shown in Slack (both `Hazel` in the template).
	const name = JSON.stringify(values.name)
	manifest = manifest
		.replace(/^(\s{4}name:) Hazel$/m, `$1 ${name}`)
		.replace(/^(\s{8}display_name:) Hazel$/m, `$1 ${name}`)
}
process.stdout.write(manifest)
