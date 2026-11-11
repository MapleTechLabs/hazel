/**
 * Simple heuristic-based language detection for code blocks.
 * Detects common languages based on distinctive patterns.
 * Returns undefined if no language can be confidently detected.
 */
export function detectLanguage(code: string): string | undefined {
	const trimmed = code.trim()

	// Skip empty or very short code
	if (trimmed.length < 3) {
		return undefined
	}

	// SQL - highly distinctive keywords (case insensitive)
	if (
		/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|WHERE|JOIN|GROUP\s+BY|ORDER\s+BY)\b/i.test(
			trimmed,
		)
	) {
		return "sql"
	}

	// Bash/Shell - shebang or common commands at start of line
	if (
		/^#!.*\b(bash|sh|zsh)\b/.test(trimmed) ||
		/^(npm|yarn|pnpm|bun|git|curl|wget|cd|ls|echo|export|source|chmod|mkdir|rm|cp|mv|cat|grep|awk|sed|sudo|apt|brew|pip|docker|kubectl)\s/m.test(
			trimmed,
		)
	) {
		return "bash"
	}

	// JSON - starts with { or [ and has key-value structure
	if (/^[[{]/.test(trimmed)) {
		// Check for JSON-like structure (quoted keys with colons)
		if (/"[^"]+"\s*:/.test(trimmed)) {
			return "json"
		}
	}

	// HTML - common HTML tags
	if (
		/<(!DOCTYPE|html|head|body|div|span|p|a|script|style|link|meta|img|form|input|button|table|ul|ol|li)\b/i.test(
			trimmed,
		)
	) {
		return "html"
	}

	// CSS - selector pattern followed by property declarations
	if (/^[.#@\w[\]:,\-\s]+\{/m.test(trimmed) && /[a-z-]+\s*:\s*[^;]+;/i.test(trimmed)) {
		return "css"
	}

	// Python - distinctive syntax
	if (
		/^(def|class|import|from|async\s+def)\s/m.test(trimmed) ||
		/^(if|elif|else|for|while|try|except|with|return|yield|raise|assert)\s.*:\s*$/m.test(trimmed) ||
		/print\s*\(/.test(trimmed)
	) {
		return "python"
	}

	// Go - distinctive patterns
	if (
		/^(package|import|func|type|struct|interface|var|const)\s/m.test(trimmed) ||
		/^func\s+\w+\s*\(/.test(trimmed) ||
		/fmt\.(Print|Println|Printf|Sprintf)/.test(trimmed)
	) {
		return "go"
	}

	// Rust - distinctive patterns
	if (
		/^(fn|impl|struct|enum|trait|mod|use|pub|let\s+mut|match)\s/m.test(trimmed) ||
		/->.*\{/.test(trimmed) ||
		/println!\(/.test(trimmed)
	) {
		return "rust"
	}

	// TypeScript - has type annotations
	if (
		/:\s*(string|number|boolean|any|void|never|unknown|object)\b/.test(trimmed) ||
		/<[A-Z]\w*>/.test(trimmed) ||
		/interface\s+\w+\s*\{/.test(trimmed) ||
		/type\s+\w+\s*=/.test(trimmed)
	) {
		return "typescript"
	}

	// JavaScript - common patterns (check after TypeScript)
	if (
		/^(const|let|var|function|async\s+function|export|import)\s/m.test(trimmed) ||
		/=>\s*[{(]/.test(trimmed) ||
		/console\.(log|error|warn|info)\(/.test(trimmed) ||
		/document\.(getElementById|querySelector|createElement)/.test(trimmed)
	) {
		return "javascript"
	}

	// YAML - key: value pattern without JS/JSON braces, multiple lines
	if (
		/^\s*[\w-]+:\s*\S/m.test(trimmed) &&
		!/[{}[\]();]/.test(trimmed) &&
		(trimmed.includes("\n") || /^\s*[\w-]+:\s*(true|false|null|\d+|".*"|'.*')$/i.test(trimmed))
	) {
		return "yaml"
	}

	// GraphQL - distinctive query/mutation syntax
	if (/^(query|mutation|subscription|fragment|type|input|enum|interface|scalar)\s/m.test(trimmed)) {
		return "graphql"
	}

	// Diff - unified diff format
	if (/^(diff\s+--git|@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@|^[-+]{3}\s)/m.test(trimmed)) {
		return "diff"
	}

	// Markdown - headers, lists, links (only if multiple markdown patterns)
	let mdScore = 0
	if (/^#{1,6}\s+\S/m.test(trimmed)) mdScore++
	if (/^\s*[-*+]\s+\S/m.test(trimmed)) mdScore++
	if (/\[.+\]\(.+\)/.test(trimmed)) mdScore++
	if (/^\s*>\s+\S/m.test(trimmed)) mdScore++
	if (/\*\*.+\*\*|__.+__/.test(trimmed)) mdScore++
	if (mdScore >= 2) {
		return "markdown"
	}

	return undefined
}
