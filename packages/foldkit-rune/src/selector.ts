// A CSS selector parser for the shapes Tailwind v4 emits, normalised so every `:is(A > *)` and
// `:where(.group)` form becomes plain compounds linked by combinators.

export type AttrTest = { name: string; op: string; value: string; insensitive: boolean }

export type Pseudo =
	| { k: "not" | "is"; list: Array<Compound> }
	| { k: "has"; list: Array<Relative> }
	| { k: "nth"; a: number; b: number; fromEnd: boolean }
	| { k: "empty" }
	/** A dynamic state the resolver cannot know (`:focus`, `:active`…): never matches. */
	| { k: "never"; name: string }

/** One compound selector; `ctx` holds what must hold around it (ancestors, parent, siblings). */
export type Compound = {
	tag?: string
	classes: Array<string>
	attrs: Array<AttrTest>
	pseudos: Array<Pseudo>
	hover: boolean
	ctx: Array<Context>
	/** Source offset of each class: the earliest is the Tailwind utility the rule belongs to. */
	classAt: Array<number>
}

export type Combinator = " " | ">" | "+" | "~"
/** `id`: the resolver's condition id for ancestor and parent links, set when the rule is stored. */
export type Context = { comb: Combinator; compound: Compound; id?: number }
export type Relative = { comb: " " | ">"; compound: Compound }

/** Selectors Rune can never match (pseudo-elements, scrollbar parts) or does not model. */
export class Unsupported {
	constructor(readonly reason: string) {}
}

const emptyCompound = (): Compound => ({
	classes: [],
	attrs: [],
	pseudos: [],
	hover: false,
	ctx: [],
	classAt: [],
})

const NEVER = new Set([
	"focus",
	"focus-visible",
	"focus-within",
	"active",
	"checked",
	"indeterminate",
	"target",
	"visited",
	"autofill",
	"invalid",
	"user-invalid",
	"valid",
	"fullscreen",
	"open",
	"popover-open",
	"placeholder-shown",
	"default",
	"required",
	"optional",
	"read-only",
	"-moz-focusring",
	"-moz-ui-invalid",
	"modal",
	"in-range",
	"out-of-range",
	"playing",
	"paused",
])

class Parser {
	i = 0
	constructor(
		readonly src: string,
		readonly base: number,
	) {}

	peek() {
		return this.src[this.i] ?? ""
	}

	ws() {
		while (/\s/.test(this.peek())) this.i++
	}

	ident(): string {
		let out = ""
		for (;;) {
			const ch = this.peek()
			if (ch === "\\") {
				// CSS escapes: up to six hex digits and one optional whitespace (Tailwind writes a
				// leading digit as `\32 xl`), else the next character as itself.
				const hex = /^[0-9a-fA-F]{1,6}/.exec(this.src.slice(this.i + 1, this.i + 7))?.[0]
				if (hex === undefined) {
					out += this.src[this.i + 1] ?? ""
					this.i += 2
				} else {
					const point = Number.parseInt(hex, 16)
					const isValid = point > 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff)
					out += String.fromCodePoint(isValid ? point : 0xfffd)
					this.i += 1 + hex.length
					if (this.src.startsWith("\r\n", this.i)) this.i += 2
					else if (/\s/.test(this.peek())) this.i++
				}
			} else if (/[\w-]/.test(ch) || ch.charCodeAt(0) > 127) {
				out += ch
				this.i++
			} else return out
		}
	}

	/** Text up to the `)` that closes the current parenthesis, nesting and escapes respected. */
	group(): string {
		let depth = 0
		const start = this.i
		for (; this.i < this.src.length; this.i++) {
			const ch = this.src[this.i]
			if (ch === "\\") this.i++
			else if (ch === "(") depth++
			else if (ch === ")") {
				if (depth === 0) break
				depth--
			}
		}
		const text = this.src.slice(start, this.i)
		this.i++
		return text
	}

	attr(): AttrTest {
		this.i++ // [
		this.ws()
		const name = this.ident()
		this.ws()
		let op = ""
		let value = ""
		let insensitive = false
		if (this.peek() !== "]") {
			while (/[~*^$|=]/.test(this.peek())) op += this.src[this.i++] ?? ""
			this.ws()
			const quote = this.peek()
			if (quote === '"' || quote === "'") {
				this.i++
				while (this.peek() !== quote && this.i < this.src.length) {
					if (this.peek() === "\\") this.i++
					value += this.src[this.i++] ?? ""
				}
				this.i++
			} else value = this.ident()
			this.ws()
			if (/[is]/i.test(this.peek()) && this.src[this.i + 1] !== "=") {
				insensitive = this.peek().toLowerCase() === "i"
				this.i++
				this.ws()
			}
		}
		this.i++ // ]
		return { name, op, value, insensitive }
	}

	compound(): Compound {
		const c = emptyCompound()
		for (;;) {
			const ch = this.peek()
			if (ch === "*") {
				this.i++
			} else if (ch === ".") {
				this.i++
				c.classAt.push(this.base + this.i)
				c.classes.push(this.ident())
			} else if (ch === "#") {
				this.i++
				c.attrs.push({ name: "id", op: "=", value: this.ident(), insensitive: false })
			} else if (ch === "[") {
				c.attrs.push(this.attr())
			} else if (ch === ":") {
				if (this.src[this.i + 1] === ":") throw new Unsupported("pseudo-element")
				this.i++
				this.pseudo(c)
			} else if (/[\w-]/.test(ch) || ch === "\\") {
				c.tag = this.ident().toLowerCase()
			} else return c
		}
	}

	pseudo(c: Compound) {
		const name = this.ident().toLowerCase()
		const arg = this.peek() === "(" ? (this.i++, this.group()) : undefined
		const argAt = this.base + this.i - (arg?.length ?? 0) - 1
		switch (name) {
			case "hover":
				c.hover = true
				return
			case "is":
			case "where":
			case "matches":
			case "not": {
				const list = parseList(arg ?? "", argAt)
				if (name === "not") return void c.pseudos.push({ k: "not", list })
				// A single complex argument is the same selector with its context pulled out.
				const only = list.length === 1 ? list[0] : undefined
				if (only !== undefined) return void merge(c, only)
				c.pseudos.push({ k: "is", list })
				return
			}
			case "has": {
				const list = splitTopLevel(arg ?? "").map((part) => {
					const trimmed = part.text.trim()
					const child = trimmed.startsWith(">")
					const sub = parseComplex(child ? trimmed.slice(1) : trimmed, argAt + part.at)
					return { comb: child ? (">" as const) : (" " as const), compound: sub }
				})
				c.pseudos.push({ k: "has", list })
				return
			}
			case "first-child":
				return void c.pseudos.push({ k: "nth", a: 0, b: 1, fromEnd: false })
			case "last-child":
				return void c.pseudos.push({ k: "nth", a: 0, b: 1, fromEnd: true })
			case "only-child":
				c.pseudos.push({ k: "nth", a: 0, b: 1, fromEnd: false })
				c.pseudos.push({ k: "nth", a: 0, b: 1, fromEnd: true })
				return
			case "nth-child":
			case "nth-last-child": {
				const nth = parseNth(arg ?? "")
				if (nth === null) throw new Unsupported(`:${name}(${arg})`)
				c.pseudos.push({ k: "nth", ...nth, fromEnd: name === "nth-last-child" })
				return
			}
			case "empty":
				return void c.pseudos.push({ k: "empty" })
			case "disabled":
				return void c.attrs.push({ name: "disabled", op: "", value: "", insensitive: false })
			case "enabled":
				c.pseudos.push({
					k: "not",
					list: [
						{
							...emptyCompound(),
							attrs: [{ name: "disabled", op: "", value: "", insensitive: false }],
						},
					],
				})
				return
			case "root":
			case "host":
				return void (c.tag = "html")
			default:
				if (NEVER.has(name) || name.startsWith("-webkit-") || name.startsWith("-moz-"))
					return void c.pseudos.push({ k: "never", name })
				throw new Unsupported(`:${name}`)
		}
	}
}

/** Merges `:is(X)` (one complex selector) into `c`: X's last compound joins c, the rest becomes context. */
const merge = (c: Compound, x: Compound) => {
	if (x.tag !== undefined) c.tag = x.tag
	c.classes.push(...x.classes)
	c.classAt.push(...x.classAt)
	c.attrs.push(...x.attrs)
	c.pseudos.push(...x.pseudos)
	c.hover ||= x.hover
	c.ctx.push(...x.ctx)
}

const parseNth = (arg: string): { a: number; b: number } | null => {
	const t = arg.replace(/\s/g, "").toLowerCase()
	if (t === "odd") return { a: 2, b: 1 }
	if (t === "even") return { a: 2, b: 0 }
	const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(t)
	if (m) {
		const a = m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number(m[1])
		return { a, b: Number(m[2] ?? 0) }
	}
	return /^[+-]?\d+$/.test(t) ? { a: 0, b: Number(t) } : null
}

/** Splits a selector list on top-level commas, keeping each part's offset. */
const splitTopLevel = (text: string): Array<{ text: string; at: number }> => {
	const out: Array<{ text: string; at: number }> = []
	let depth = 0
	let start = 0
	let quote = ""
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (ch === "\\") i++
		else if (quote !== "") {
			if (ch === quote) quote = ""
		} else if (ch === '"' || ch === "'") quote = ch
		else if (ch === "(" || ch === "[") depth++
		else if (ch === ")" || ch === "]") depth--
		else if (ch === "," && depth === 0) {
			out.push({ text: text.slice(start, i), at: start })
			start = i + 1
		}
	}
	out.push({ text: text.slice(start), at: start })
	return out.filter((part) => part.text.trim() !== "")
}

const parseList = (text: string, base: number): Array<Compound> =>
	splitTopLevel(text).map((part) => parseComplex(part.text, base + part.at))

/** A complex selector as its subject compound, every compound before it nested as context. */
export const parseComplex = (text: string, base = 0): Compound => {
	const p = new Parser(text, base)
	p.ws()
	let subject = p.compound()
	for (;;) {
		const before = p.i
		p.ws()
		if (p.i >= text.length) return subject
		let comb: Combinator = " "
		const ch = p.peek()
		if (ch === ">" || ch === "+" || ch === "~") {
			comb = ch
			p.i++
			p.ws()
		} else if (p.i === before) throw new Unsupported(`unexpected "${ch}"`)
		const next = p.compound()
		next.ctx.push({ comb, compound: subject })
		subject = next
	}
}

/**
 * A selector's specificity as one number (ids, then classes / attributes / pseudo-classes, then
 * types): `:where()` adds nothing, `:is()` / `:not()` / `:has()` their most specific argument.
 */
/** The last index of the CSS escape whose backslash is at `i`: hex digits and one whitespace, or one character. */
const escapeEnd = (text: string, i: number): number => {
	const hex = /^[0-9a-fA-F]{1,6}/.exec(text.slice(i + 1, i + 7))?.[0]
	if (hex === undefined) return i + 1
	const end = i + hex.length
	return /\s/.test(text[end + 1] ?? "") ? end + 1 : end
}

export const specificity = (text: string): number => {
	let total = 0
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (ch === "\\") {
			// The escape and the rest of its identifier: what follows is not a new compound.
			i = escapeEnd(text, i)
			while (/[\w-]/.test(text[i + 1] ?? "")) i++
		} else if (ch === "#") total += 10000
		else if (ch === ".") total += 100
		else if (ch === "[") {
			total += 100
			while (i < text.length && text[i] !== "]") i++
		} else if (ch === ":") {
			if (text[i + 1] === ":") {
				total += 1
				i++
				while (/[\w-]/.test(text[i + 1] ?? "")) i++
				continue
			}
			let name = ""
			while (/[\w-]/.test(text[i + 1] ?? "")) name += text[++i]
			if (text[i + 1] !== "(") {
				total += 100
				continue
			}
			let depth = 0
			const start = i + 2
			for (i++; i < text.length; i++) {
				if (text[i] === "\\") i = escapeEnd(text, i)
				else if (text[i] === "(") depth++
				else if (text[i] === ")" && --depth === 0) break
			}
			const arg = text.slice(start, i)
			if (name === "where") continue
			if (name === "is" || name === "not" || name === "has" || name === "matches")
				total += Math.max(0, ...splitTopLevel(arg).map((part) => specificity(part.text)))
			else total += 100
		} else if (/[a-zA-Z]/.test(ch ?? "") && (i === 0 || /[\s>+~(,]/.test(text[i - 1] ?? ""))) {
			total += 1
			while (/[\w-]/.test(text[i + 1] ?? "")) i++
		}
	}
	return total
}

/** Every selector of a rule's selector list; ones Rune cannot model come back as `Unsupported`. */
export const parseSelectorList = (
	text: string,
): Array<{ selector: Compound; specificity: number } | Unsupported> =>
	splitTopLevel(text).map((part) => {
		try {
			return { selector: parseComplex(part.text.trim()), specificity: specificity(part.text.trim()) }
		} catch (error) {
			if (error instanceof Unsupported) return error
			throw error
		}
	})
