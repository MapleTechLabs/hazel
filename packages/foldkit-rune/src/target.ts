import type { Document } from "foldkit/html"
import type { RenderTarget } from "foldkit/runtime"

import type { ElementBridge } from "./bridge"
import { type NodeInfo, type Scope, type Style, StyleResolver, color } from "./style"
import type { CommitStats, HostToRuntime, RuntimeToHost, WireNode } from "./wire"

/** Event-shaped objects with the fields Foldkit's handlers read (see foldkit html/index.ts). */
const fakeEvent = (event: Extract<HostToRuntime, { t: "event" }>) => {
	const eventTarget = { value: event.value ?? "", scrollTop: 0, open: false, files: [] }
	return {
		type: event.type,
		target: eventTarget,
		currentTarget: eventTarget,
		key: event.key ?? "",
		shiftKey: event.shift ?? false,
		ctrlKey: event.ctrl ?? false,
		altKey: event.alt ?? false,
		metaKey: event.meta ?? false,
		isComposing: false,
		button: 0,
		pointerType: "mouse",
		timeStamp: performance.now(),
		defaultPrevented: false,
		preventDefault() {},
		stopPropagation() {},
	}
}

type HostEvent = ReturnType<typeof fakeEvent>

type Handler = (event: HostEvent) => void

/** An element's own wire fields, everything but its hash and children. */
type ElementFields = {
	tag: string
	key?: string
	st: Style
	attrs: Record<string, string>
	on: Record<string, number>
	mount?: string
	o?: 1
}

type AnyVNode = {
	sel?: string
	key?: string | number
	text?: string
	children?: Array<AnyVNode | string>
	data?: {
		class?: Record<string, boolean>
		props?: Record<string, unknown>
		attrs?: Record<string, unknown>
		dataset?: Record<string, unknown>
		on?: Record<string, Handler | Array<Handler>>
		style?: Record<string, unknown>
		hook?: Record<string, unknown>
		foldkitMount?: { name?: string; args?: Record<string, unknown> }
	}
}

export type Env = { width: number; height: number; dark: boolean }

export type RuneTargetOptions = {
	readonly styles: StyleResolver
	readonly env: Env
	readonly send: (message: RuntimeToHost) => void
	readonly onStats?: (stats: CommitStats) => void
	readonly onRelease?: () => void
	/** Element proxies for geometry-observing Mounts; without it no Mount is acquired. */
	readonly bridge?: ElementBridge
	/** The text a DOM-backed Mount (an editor) currently holds, drawn as a native text field. */
	readonly editableText?: (path: string) => string | undefined
	/** The class of the element a DOM-backed Mount edits in (the editor's root), styled onto the field. */
	readonly editableClass?: (path: string) => string | undefined
	/** A native text field over a DOM-backed Mount was edited, or a key was pressed in it. */
	readonly onEditable?: (path: string, event: { readonly value?: string; readonly key?: string }) => void
}

const NON_VISUAL_TAGS = new Set(["style", "script", "template", "noscript", "link", "meta"])
const HOST_ATTRS = [
	"value",
	"placeholder",
	"type",
	"href",
	"src",
	"alt",
	"role",
	"disabled",
	"aria-label",
	"tabindex",
]
const SVG_ATTRS = new Set([
	"d",
	"x",
	"y",
	"x1",
	"x2",
	"y1",
	"y2",
	"cx",
	"cy",
	"r",
	"rx",
	"ry",
	"width",
	"height",
	"points",
	"fill",
	"stroke",
	"stroke-width",
	"stroke-linecap",
	"stroke-linejoin",
	"fill-rule",
	"clip-rule",
	"opacity",
	"fill-opacity",
	"stroke-opacity",
	"text-anchor",
	"dominant-baseline",
	"font-size",
	"font-weight",
])

const tagOf = (vnode: AnyVNode) => vnode.sel?.split(/[#.]/)[0] || "div"
/** Classes from `h.Class`, a `class` attribute (`h.Attribute("class", …)`, common on SVG) and the selector. */
const classesOf = (vnode: AnyVNode): Array<string> => {
	const out = new Set<string>()
	for (const [name, isOn] of Object.entries(vnode.data?.class ?? {})) if (isOn) out.add(name)
	for (const source of [vnode.data?.attrs?.class, vnode.data?.props?.className])
		if (typeof source === "string") for (const name of source.split(/\s+/)) if (name !== "") out.add(name)
	for (const name of vnode.sel?.split("#")[0]?.split(".").slice(1) ?? []) if (name !== "") out.add(name)
	return [...out]
}

const attrsOf = (vnode: AnyVNode): Record<string, string> => {
	const out: Record<string, string> = {}
	const data = vnode.data ?? {}
	for (const source of [data.attrs, data.props]) {
		for (const name in source) {
			const value = source[name]
			if (value === undefined || value === null || value === false) continue
			if (typeof value === "object" || typeof value === "function") continue
			// `h.Tabindex` sets the `tabIndex` property; the DOM reflects it as the attribute.
			out[name === "tabIndex" ? "tabindex" : name] = String(value)
		}
	}
	for (const name in data.dataset) {
		out[`data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = String(data.dataset[name])
	}
	return out
}

/** `:empty`: no element children and no text. */
const isEmpty = (vnode: AnyVNode): boolean =>
	(vnode.text ?? "") === "" &&
	typeof vnode.data?.props?.innerHTML !== "string" &&
	(vnode.children ?? []).every((child) =>
		typeof child === "string"
			? child === ""
			: child.sel === "!" || (child.sel === undefined && (child.text ?? "") === ""),
	)

/** A fill or stroke in a CSS colour syntax an SVG rasteriser may not read (oklch, color-mix…) as hex. */
const svgPaint = (name: string, value: string): string => {
	if ((name !== "fill" && name !== "stroke") || !/^[a-z-]+\(/i.test(value) || /^(rgba?|url)\(/i.test(value))
		return value
	const hex = color(value)
	return hex === null ? value : hex.endsWith("ff") ? hex.slice(0, 7) : hex
}

/** An SVG subtree as a flat icon body: `<g>` attributes pushed down onto their children. */
const svgBody = (vnode: AnyVNode, inherited: Record<string, string> = {}): string =>
	(vnode.children ?? [])
		.map((child) => {
			if (typeof child === "string" || child.sel === undefined) return ""
			const attrs = { ...inherited, ...attrsOf(child) }
			const tag = tagOf(child)
			if (tag === "g") return svgBody(child, attrs)
			const list = Object.entries(attrs)
				.filter(([name]) => SVG_ATTRS.has(name))
				.map(([name, value]) => `${name}="${svgPaint(name, value).replace(/"/g, "&quot;")}"`)
			// The host lays `<text>` over the icon itself (its rasteriser has no fonts): keep the words.
			if (tag === "text") return `<text ${list.join(" ")}>${escapeXml(textOf(child))}</text>`
			return `<${tag} ${list.join(" ")}/>`
		})
		.join("")

const textOf = (vnode: AnyVNode): string =>
	vnode.text ?? (vnode.children ?? []).map((c) => (typeof c === "string" ? c : textOf(c))).join("")

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** cyrb53: fast, well-mixed 53-bit string hash; collisions only cost a redundant rebuild. */
const ENTITIES = new Map([
	["amp", "&"],
	["lt", "<"],
	["gt", ">"],
	["quot", '"'],
	["apos", "'"],
	["nbsp", " "],
])

/** A numeric character reference's code point, or the reference itself when it names none. */
const codePointText = (match: string, point: number): string =>
	Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match

/** An HTML fragment's text: line breaks kept, tags dropped, entities decoded. */
export const htmlText = (html: string): string =>
	html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, code: string) => {
			if (/^#x/i.test(code)) return codePointText(match, Number.parseInt(code.slice(2), 16))
			if (code.startsWith("#")) return codePointText(match, Number(code.slice(1)))
			return ENTITIES.get(code) ?? match
		})
		.replace(/\n$/, "")

/** `h.Style` declarations as CSS property names and string values. */
const inlineStyleOf = (vnode: AnyVNode): Record<string, string> | undefined => {
	const style = vnode.data?.style
	const attribute = vnode.data?.attrs?.style
	if (style === undefined && typeof attribute !== "string") return undefined
	const out: Record<string, string> = {}
	if (typeof attribute === "string") {
		for (const declaration of attribute.split(";")) {
			const colon = declaration.indexOf(":")
			if (colon > 0) out[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim()
		}
	}
	for (const name in style) {
		const value = style[name]
		if (typeof value === "string" || typeof value === "number") {
			out[name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)] = String(value)
		}
	}
	return out
}

const hash = (text: string): string => {
	let h1 = 0xdeadbeef
	let h2 = 0x41c6ce57
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i)
		h1 = Math.imul(h1 ^ code, 2654435761)
		h2 = Math.imul(h2 ^ code, 1597334677)
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * A Foldkit RenderTarget that resolves each committed Document to the native host's wire tree.
 * Handler ids are stable per element path, so an unchanged subtree hashes the same between
 * commits and goes over the wire as a reference.
 */
/** How many sent trees keep their handlers (each keystroke sends one); a press on an older tree is dropped. */
const HANDLER_GENERATIONS = 32

export const makeRuneTarget = (options: RuneTargetOptions) => {
	const { styles, send } = options
	const env = { ...options.env }
	let handlers = new Map<number, Handler>()
	/** Each sent tree's handlers by its generation: a press runs the handler the user saw. */
	const handlersByGen = new Map<number, Map<number, Handler>>()
	let gen = 0
	const handlerIds = new Map<string, number>()
	let sentHashes = new Set<string>()
	let lastDocument: Document | undefined
	let ack = 0
	/** The newest host event the last committed document reflects. */
	let lastDocumentAck = 0
	let frameStartedAt = 0

	const handlerId = (path: string, event: string): number => {
		const key = `${path}#${event}`
		let id = handlerIds.get(key)
		if (id === undefined) {
			id = handlerIds.size + 1
			handlerIds.set(key, id)
		}
		return id
	}

	const collectClasses = (vnode: AnyVNode | string, into: Set<string>) => {
		if (typeof vnode === "string") return
		for (const name of classesOf(vnode)) into.add(name)
		for (const child of vnode.children ?? []) collectClasses(child, into)
	}

	/** The element children of a VNode (text and comment nodes skipped), as selectors see them. */
	const elementChildren = (vnode: AnyVNode): Array<{ vnode: AnyVNode; info: NodeInfo }> => {
		const kids = (vnode.children ?? []).filter(
			(child): child is AnyVNode =>
				typeof child !== "string" && child.sel !== undefined && child.sel !== "!",
		)
		return kids.map((child, index) => ({
			vnode: child,
			info: {
				tag: tagOf(child),
				classes: classesOf(child),
				attrs: attrsOf(child),
				index,
				count: kids.length,
				empty: isEmpty(child),
			},
		}))
	}

	const hasDescendant =
		(vnode: AnyVNode) =>
		(match: (node: NodeInfo) => boolean, childrenOnly = false): boolean =>
			elementChildren(vnode).some(
				(child) => match(child.info) || (!childrenOnly && hasDescendant(child.vnode)(match)),
			)

	const commitDocument = (document: Document, documentAck: number) => {
		const viewMs = frameStartedAt === 0 ? 0 : performance.now() - frameStartedAt
		frameStartedAt = 0
		const started = performance.now()
		const body = document.body as AnyVNode | null
		const classes = new Set<string>()
		if (body) collectClasses(body, classes)
		// New classes after boot (a state's first variant) compile after this commit, off the input
		// path: the compile re-parses the whole sheet, and a frame without one class beats a slow key.
		const fresh = styles.isCompiled ? styles.unknown(classes) : []
		if (fresh.length > 0)
			setTimeout(() => {
				if (styles.ensure(fresh) && lastDocument !== undefined)
					commitDocument(lastDocument, lastDocumentAck)
			}, 0)
		else styles.ensure(classes)
		styles.setViewport(env.width, env.height)

		const records = new Map<
			string,
			Parameters<ElementBridge["commit"]>[0] extends Map<string, infer R> ? R : never
		>()
		const mountVNodes = new Map<string, AnyVNode>()
		const nextHandlers = new Map<number, Handler>()
		const nextHashes = new Set<string>()
		let nodes = 0
		let reusedSubtrees = 0

		const serialize = (
			vnode: AnyVNode | string,
			path: string,
			parentPath: string | undefined,
			scope: Scope,
			position: { siblings: ReadonlyArray<NodeInfo>; index: number } | undefined,
		): WireNode => {
			if (typeof vnode === "string") return { k: "t", s: vnode }
			if (vnode.sel === undefined) return { k: "t", s: vnode.text ?? "" }
			const tag = tagOf(vnode)
			if (NON_VISUAL_TAGS.has(tag)) return { k: "t", s: "" }
			nodes += 1
			const attrs = attrsOf(vnode)
			const classes = classesOf(vnode)
			options.bridge?.recordElement(path, parentPath, tag, attrs, classes, records)
			if (vnode.data?.foldkitMount !== undefined) mountVNodes.set(path, vnode)
			const inline = inlineStyleOf(vnode)
			const resolved = styles.resolve(
				{
					tag,
					classes,
					attrs,
					inline,
					// Read only by sibling selectors (`peer-*`, `[&+x]`): built when one asks.
					get prevSiblings() {
						return position?.siblings.slice(0, position.index).reverse()
					},
					index: position?.index,
					count: position?.siblings.length,
					empty: isEmpty(vnode),
					hasDescendant: hasDescendant(vnode),
				},
				scope,
				env.dark,
				env.width,
			)
			const st: Style = resolved.style
			if (tag === "svg") {
				const view = Number((attrs.viewBox ?? "0 0 24 24").split(/\s+/)[2]) || 24
				const sized: Style = {
					...st,
					w: st.w ?? (attrs.width ? Number(attrs.width) : undefined),
					h: st.h ?? (attrs.height ? Number(attrs.height) : undefined),
				}
				const body = svgBody(vnode)
				// `none` stretches the drawing to the box (the dithered avatar); absent means `xMidYMid meet`.
				const par = attrs.preserveAspectRatio
				const h = hash(`svg${view}${body}${JSON.stringify(sized)}${par ?? ""}`)
				nextHashes.add(h)
				if (sentHashes.has(h)) {
					reusedSubtrees += 1
					return { k: "r", h }
				}
				return par === undefined
					? { k: "svg", h, view, body, st: sized }
					: { k: "svg", h, view, body, st: sized, par }
			}
			const on: Record<string, number> = {}
			for (const event in vnode.data?.on) {
				const fn = vnode.data.on[event]
				const id = handlerId(path, event)
				nextHandlers.set(id, (e) => (Array.isArray(fn) ? fn.forEach((f) => f(e)) : fn?.(e)))
				on[event] = id
			}
			const keep: Record<string, string> = {}
			for (const name of HOST_ATTRS) if (name in attrs) keep[name] = attrs[name] as string
			const siblings = elementChildren(vnode)
			const infoOf = new Map(siblings.map((sib) => [sib.vnode, sib.info]))
			const infos = siblings.map((sib) => sib.info)
			const children: Array<WireNode> = []
			const childList = vnode.children ?? []
			for (let index = 0; index < childList.length; index++) {
				const child = childList[index] as AnyVNode | string
				const segment =
					typeof child !== "string" && child.key !== undefined ? `k${child.key}` : `${index}`
				const info = typeof child === "string" ? undefined : infoOf.get(child)
				const position = info === undefined ? undefined : { siblings: infos, index: info.index ?? 0 }
				children.push(serialize(child, `${path}/${segment}`, path, resolved.scope, position))
			}
			if (vnode.text !== undefined && children.length === 0) children.push({ k: "t", s: vnode.text })
			// `h.InnerHTML` (highlighted code, rendered markdown) carries no child VNodes: keep its text.
			const innerHtml = vnode.data?.props?.innerHTML
			if (typeof innerHtml === "string" && children.length === 0)
				children.push({ k: "t", s: htmlText(innerHtml) })
			const mount = vnode.data?.foldkitMount?.name
			if (mount !== undefined && options.bridge?.isDomMount(mount)) {
				keep["data-editable"] = "1"
				keep.value = options.editableText?.(path) ?? ""
				keep.placeholder = String(vnode.data?.foldkitMount?.args?.placeholder ?? "")
				// The editor's own box (padding, text size, minimum height) lives in the headless DOM:
				// its resolved style rides along as the field's one child.
				const fieldClasses = (options.editableClass?.(path) ?? "")
					.split(/\s+/)
					.filter((c) => c !== "")
				if (fieldClasses.length > 0) {
					styles.ensure(fieldClasses)
					const field = styles.resolve(
						{
							tag: "div",
							classes: fieldClasses,
							attrs: {},
							empty: true,
							hasDescendant: () => false,
						},
						resolved.scope,
						env.dark,
						env.width,
					).style
					children.push({
						k: "e",
						h: hash(`field${JSON.stringify(field)}`),
						tag: "div",
						st: field,
						attrs: {},
						on: {},
						c: [],
					})
				}
			}
			const self: ElementFields = { tag, st, attrs: keep, on }
			if (vnode.key !== undefined) self.key = String(vnode.key)
			if (mount !== undefined) self.mount = mount
			if (options.bridge?.isObserved(path)) self.o = 1
			const h = hash(
				JSON.stringify(self) +
					children.map((c) => ("h" in c ? c.h : c.k === "t" ? c.s : "")).join("\u0000"),
			)
			nextHashes.add(h)
			if (sentHashes.has(h)) {
				reusedSubtrees += 1
				return { k: "r", h }
			}
			return { k: "e", h, ...self, c: children }
		}

		const root: WireNode =
			body === null
				? { k: "t", s: "" }
				: serialize(body, "r", undefined, styles.rootScope(env.dark), undefined)
		handlers = nextHandlers
		gen += 1
		handlersByGen.set(gen, nextHandlers)
		handlersByGen.delete(gen - HANDLER_GENERATIONS)
		sentHashes = nextHashes
		options.bridge?.commit(records, mountVNodes)
		const message: RuntimeToHost = {
			t: "tree",
			ack: documentAck,
			gen,
			title: document.title,
			page: styles.pageStyle(env.dark),
			root,
		}
		const line = JSON.stringify(message)
		send(message)
		options.onStats?.({
			viewMs,
			styleAndSerializeMs: performance.now() - started,
			bytes: line.length,
			nodes,
			reusedSubtrees,
			handlers: nextHandlers.size,
		})
	}

	const target: RenderTarget = {
		id: "foldkit-rune",
		commit: (document) => {
			// Messages dispatch synchronously, so a new document reflects every event received.
			lastDocument = document
			lastDocumentAck = ack
			commitDocument(document, ack)
		},
		requestFrame: (frame) => {
			setTimeout(() => {
				frameStartedAt = performance.now()
				frame()
			}, 0)
		},
		release: () => options.onRelease?.(),
	}

	const handleHostMessage = (message: HostToRuntime) => {
		if (message.t === "env") {
			Object.assign(env, { width: message.width, height: message.height, dark: message.dark })
			// Styles depend on the window and theme, not the Model: re-resolve what is on screen.
			if (lastDocument) {
				sentHashes = new Set()
				commitDocument(lastDocument, lastDocumentAck)
			}
			return
		}
		if (message.t === "layout") {
			options.bridge?.reportLayout(message.path, {
				x: message.x,
				y: message.y,
				width: message.w,
				height: message.h,
			})
			return
		}
		if (message.t === "scrolled") {
			options.bridge?.reportScroll(message.path, message.top)
			return
		}
		if (message.t !== "event") return
		ack = Math.max(ack, message.seq)
		if (message.type === "editable" && message.path !== undefined) {
			options.onEditable?.(message.path, { value: message.value, key: message.key })
			return
		}
		// A press on a tree no longer kept is dropped: the newest handler may be a different action.
		const presented = message.gen === undefined ? handlers : handlersByGen.get(message.gen)
		const handler = presented?.get(message.id)
		handler?.(fakeEvent(message))
	}

	/** A Mount that starts observing an element after a commit needs it flagged for the host. */
	let isRefreshScheduled = false
	// A precompiled sheet compiles classes it lacked off the input path: restyle once they are in.
	styles.onRecompiled(() => {
		if (lastDocument) commitDocument(lastDocument, lastDocumentAck)
	})

	const refreshObserved = () => {
		if (isRefreshScheduled || lastDocument === undefined) return
		isRefreshScheduled = true
		setTimeout(() => {
			isRefreshScheduled = false
			if (lastDocument) commitDocument(lastDocument, lastDocumentAck)
		}, 0)
	}

	return { target, handleHostMessage, env, refreshObserved }
}
