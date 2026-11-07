import type { Document } from "foldkit/html"
import type { RenderTarget } from "foldkit/runtime"

import type { ElementBridge } from "./bridge"
import { type Scope, type Style, StyleResolver } from "./style"
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
	/** A native text field over a DOM-backed Mount was edited, or a key was pressed in it. */
	readonly onEditable?: (path: string, event: { readonly value?: string; readonly key?: string }) => void
}

const NON_VISUAL_TAGS = new Set(["style", "script", "template", "noscript", "link", "meta"])
const HOST_ATTRS = ["value", "placeholder", "type", "href", "src", "alt", "role", "disabled", "aria-label"]
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
])

const tagOf = (vnode: AnyVNode) => vnode.sel?.split(/[#.]/)[0] || "div"
const classesOf = (vnode: AnyVNode) =>
	Object.entries(vnode.data?.class ?? {})
		.filter(([, isOn]) => isOn)
		.map(([name]) => name)

const attrsOf = (vnode: AnyVNode): Record<string, string> => {
	const out: Record<string, string> = {}
	const data = vnode.data ?? {}
	for (const source of [data.attrs, data.props]) {
		for (const name in source) {
			const value = source[name]
			if (value === undefined || value === null || value === false) continue
			if (typeof value === "object" || typeof value === "function") continue
			out[name] = String(value)
		}
	}
	for (const name in data.dataset) {
		out[`data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = String(data.dataset[name])
	}
	return out
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
				.map(([name, value]) => `${name}="${value.replace(/"/g, "&quot;")}"`)
			return `<${tag} ${list.join(" ")}/>`
		})
		.join("")

/** cyrb53: fast, well-mixed 53-bit string hash; collisions only cost a redundant rebuild. */
const ENTITIES = new Map([
	["amp", "&"],
	["lt", "<"],
	["gt", ">"],
	["quot", '"'],
	["apos", "'"],
	["nbsp", " "],
])

/** An HTML fragment's text: line breaks kept, tags dropped, entities decoded. */
const htmlText = (html: string): string =>
	html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, code: string) => {
			if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
			if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)))
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
export const makeRuneTarget = (options: RuneTargetOptions) => {
	const { styles, send } = options
	const env = { ...options.env }
	let handlers = new Map<number, Handler>()
	const handlerIds = new Map<string, number>()
	let sentHashes = new Set<string>()
	let lastDocument: Document | undefined
	let ack = 0
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

	const hasDescendant =
		(vnode: AnyVNode) =>
		(cond: { attrs: Array<[string, string | null]>; tag?: string }): boolean =>
			(vnode.children ?? []).some((child) => {
				if (typeof child === "string" || child.sel === undefined) return false
				const attrs = attrsOf(child)
				const isMatch =
					(cond.tag === undefined || tagOf(child) === cond.tag) &&
					cond.attrs.every(([n, v]) => (v === null ? n in attrs : attrs[n] === v))
				return isMatch || hasDescendant(child)(cond)
			})

	const commitDocument = (document: Document) => {
		const viewMs = frameStartedAt === 0 ? 0 : performance.now() - frameStartedAt
		frameStartedAt = 0
		const started = performance.now()
		const body = document.body as AnyVNode | null
		const classes = new Set<string>()
		if (body) collectClasses(body, classes)
		styles.ensure(classes)
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
			prevAttrs: Record<string, string> | undefined,
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
				{ classes, attrs, inline, prevAttrs, hasDescendant: hasDescendant(vnode) },
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
				const h = hash(`svg${view}${body}${JSON.stringify(sized)}`)
				nextHashes.add(h)
				return sentHashes.has(h)
					? (reusedSubtrees++, { k: "r", h })
					: { k: "svg", h, view, body, st: sized }
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
			let previous: Record<string, string> | undefined
			const children: Array<WireNode> = []
			const childList = vnode.children ?? []
			for (let index = 0; index < childList.length; index++) {
				const child = childList[index] as AnyVNode | string
				const segment =
					typeof child !== "string" && child.key !== undefined ? `k${child.key}` : `${index}`
				children.push(serialize(child, `${path}/${segment}`, path, resolved.scope, previous))
				if (typeof child !== "string" && child.sel !== undefined) previous = attrsOf(child)
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
		sentHashes = nextHashes
		options.bridge?.commit(records, mountVNodes)
		const message: RuntimeToHost = {
			t: "tree",
			ack,
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
			lastDocument = document
			commitDocument(document)
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
				commitDocument(lastDocument)
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
		handlers.get(message.id)?.(fakeEvent(message))
	}

	/** A Mount that starts observing an element after a commit needs it flagged for the host. */
	let isRefreshScheduled = false
	const refreshObserved = () => {
		if (isRefreshScheduled || lastDocument === undefined) return
		isRefreshScheduled = true
		setTimeout(() => {
			isRefreshScheduled = false
			if (lastDocument) commitDocument(lastDocument)
		}, 0)
	}

	return { target, handleHostMessage, env, refreshObserved }
}
