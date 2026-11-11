import Prism from "prismjs"
import "prismjs/components/prism-bash"
import "prismjs/components/prism-c"
import "prismjs/components/prism-cpp"
import "prismjs/components/prism-csharp"
import "prismjs/components/prism-css"
import "prismjs/components/prism-diff"
import "prismjs/components/prism-go"
import "prismjs/components/prism-graphql"
import "prismjs/components/prism-java"
import "prismjs/components/prism-javascript"
import "prismjs/components/prism-json"
import "prismjs/components/prism-jsx"
import "prismjs/components/prism-kotlin"
import "prismjs/components/prism-markdown"
import "prismjs/components/prism-markup-templating"
import "prismjs/components/prism-php"
import "prismjs/components/prism-python"
import "prismjs/components/prism-ruby"
import "prismjs/components/prism-rust"
import "prismjs/components/prism-scss"
import "prismjs/components/prism-sql"
import "prismjs/components/prism-swift"
import "prismjs/components/prism-typescript"
import "prismjs/components/prism-tsx"
import "prismjs/components/prism-yaml"

/**
 * Prism highlighting for message code blocks, ported from the legacy `decorateCodeBlock`. Every
 * language the legacy decorator could lazy-load is registered up front, so a view stays a pure
 * function of the code (no load-then-rerender).
 */

/** Aliases the legacy loader accepted that Prism doesn't register itself. */
const ALIASES: Readonly<Record<string, string>> = { yml: "yaml", md: "markdown", rb: "ruby", rs: "rust" }

/** A run of code and the Prism token types it is nested in (outermost first); none for plain text. */
export interface CodeLeaf {
	readonly text: string
	readonly tokenTypes: ReadonlyArray<string> | null
}

const flatten = (token: string | Prism.Token, types: ReadonlyArray<string>): ReadonlyArray<CodeLeaf> => {
	if (typeof token === "string") return token.length > 0 ? [{ text: token, tokenTypes: types }] : []
	const nested = [...types, token.type]
	return Array.isArray(token.content)
		? token.content.flatMap((child) => flatten(child, nested))
		: flatten(token.content, nested)
}

/** The code split into Prism tokens, or one plain leaf when the language has no grammar. */
export const codeLeaves = (code: string, language: string | null): ReadonlyArray<CodeLeaf> => {
	const name = (language ?? "plaintext").toLowerCase()
	const grammar = Prism.languages[ALIASES[name] ?? name]
	if (!grammar || code === "") return [{ text: code, tokenTypes: null }]
	return Prism.tokenize(code, grammar).flatMap((token) => flatten(token, []))
}

/** The legacy leaf class: `token` plus each token type once, in nesting order. */
export const codeLeafClassName = (leaf: CodeLeaf): string =>
	leaf.tokenTypes === null ? "" : ["token", ...new Set(leaf.tokenTypes)].join(" ")
