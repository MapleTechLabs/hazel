/**
 * Parity rules for shared `hazel` screens (`docs/hazel-ui.md`, "Rules"; contract C1). The vocabulary
 * types close the escape hatches where they can; these rules close the rest at lint time:
 *
 * - `no-raw-escape` (shared screens): no `attr`/`attrs`/`prop`/`el`, no `Html`, Foldkit or a host's
 *   own modules, no style tokens, and no extension or composite defined outside `packages/ui`.
 * - `custom-cap` (`packages/ui/src/custom/`): the number of governed `h.custom` composites stays at or
 *   under the cap in `.oxlintrc.json`. Only the user raises it.
 */
import { readdirSync } from "node:fs"
import { dirname } from "node:path"

const RAW_METHODS = new Set(["attr", "attrs", "prop"])

/** Imports a shared screen may not name, with what to use instead. */
const BANNED_IMPORTS = [
	[/^@effect\/ui\/html(\/|$)/, "`Html` draws only on the web: use `hazel` tags, or a web extension"],
	[/^@effect\/ui\/View$/, "`View` has `el` and raw builders: use `Hazel.component` and `h`"],
	[/^foldkit(\/|$)/, "Foldkit is the web app's: a shared screen is a `hazel` component"],
	[/^@hazel\/ui\/web(\/|$)/, "a host's own modules belong to the host, not to a shared screen"],
	[/^@hazel\/ui\/native(\/|$)/, "a host's own modules belong to the host, not to a shared screen"],
	[/^@hazel\/ui\/style(\/|$)/, "style is the primitives': pick options from the closed sets"],
	[/^@hazel\/ui\/gallery(\/|$)/, "the gallery is tooling"],
]

/** Builders that define vocabulary: only `packages/ui` may call them. */
const DEFINERS = new Set(["extension", "composite"])

const propertyName = (member) =>
	member.type === "MemberExpression" && !member.computed && member.property.type === "Identifier"
		? member.property.name
		: undefined

const noRawEscape = {
	meta: {
		type: "problem",
		docs: { description: "Shared screens use only the `hazel` vocabulary's typed props." },
		messages: {
			rawMethod:
				"`.{{name}}(...)` is a raw escape hatch: a shared screen sets only typed `hazel` props. Missing an option? Mark it `// HAZEL-GAP(<id>): <need>` and add it to packages/ui/GAPS.md.",
			rawEl: "`{{object}}.el` builds a raw element no native host draws: use a `hazel` tag.",
			bannedImport: "`{{source}}`: {{why}}.",
			definer:
				"`{{object}}.{{name}}(...)` defines vocabulary: extensions go in packages/ui/src/extensions/, composites in packages/ui/src/custom/.",
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const name = propertyName(node.callee)
				if (name === undefined) return
				if (RAW_METHODS.has(name))
					context.report({ node: node.callee.property, messageId: "rawMethod", data: { name } })
				else if (
					DEFINERS.has(name) &&
					node.callee.object.type === "Identifier" &&
					node.callee.object.name === "Hazel"
				)
					context.report({ node, messageId: "definer", data: { object: "Hazel", name } })
			},
			MemberExpression(node) {
				if (propertyName(node) !== "el") return
				const object = node.object.type === "Identifier" ? node.object.name : "…"
				context.report({ node: node.property, messageId: "rawEl", data: { object } })
			},
			ImportDeclaration(node) {
				const source = node.source.value
				for (const [pattern, why] of BANNED_IMPORTS)
					if (pattern.test(source))
						context.report({
							node: node.source,
							messageId: "bannedImport",
							data: { source, why },
						})
			},
		}
	},
}

const customCap = {
	meta: {
		type: "problem",
		docs: { description: "The number of governed composites stays under the cap the user sets." },
		schema: [{ type: "object", properties: { cap: { type: "number" } }, additionalProperties: false }],
		messages: {
			overCap:
				"packages/ui/src/custom/ holds {{count}} composites; the cap is {{cap}}. A composite a second screen wants is a candidate primitive; only the user raises the cap (.oxlintrc.json).",
		},
	},
	create(context) {
		const cap = context.options[0]?.cap ?? 0
		return {
			Program(program) {
				const files = readdirSync(dirname(context.filename)).filter(
					(file) => file.endsWith(".ts") && file !== "index.ts" && !file.includes(".test."),
				)
				if (files.length > cap)
					context.report({
						node: program,
						messageId: "overCap",
						data: { count: files.length, cap },
					})
			},
		}
	},
}

export default {
	meta: { name: "hazel" },
	rules: { "no-raw-escape": noRawEscape, "custom-cap": customCap },
}
