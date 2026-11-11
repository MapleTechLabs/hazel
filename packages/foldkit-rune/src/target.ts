import type { Document } from "foldkit/html"
import type { RenderTarget } from "foldkit/runtime"

import { type ElementBridge, hostFocusKey, matchesElement } from "./bridge"
import type { OverlayWire, Overlays } from "./overlays"
import { type NodeInfo, type Scope, type Style, StyleResolver, color } from "./style"
import type { CommitStats, HostToRuntime, RuntimeToHost, WireNode } from "./wire"

/** Event-shaped objects with the fields Foldkit's handlers read (see foldkit html/index.ts). */
/** What the `Dom` helpers ask of a target (`Dom.focus`, `Dom.scrollIntoView`, ...). */
type TargetDomEffects = NonNullable<RenderTarget["dom"]>

/**
 * A keydown on `document` (where an app's shortcuts listen), as the browser dispatches one that
 * bubbled up or that nothing focused took. Whether a listener prevented its default.
 */
const dispatchDocumentKey = (key: {
	readonly key?: string
	readonly shift?: boolean
	readonly meta?: boolean
	readonly ctrl?: boolean
	readonly alt?: boolean
}): boolean => {
	const target: EventTarget | undefined = globalThis.document
	if (target === undefined || key.key === undefined) return false
	const KeyboardEventClass: new (type: string, init?: KeyboardEventInit) => Event =
		globalThis.KeyboardEvent ?? Event
	const event = new KeyboardEventClass("keydown", {
		key: key.key,
		shiftKey: key.shift ?? false,
		metaKey: key.meta ?? false,
		ctrlKey: key.ctrl ?? false,
		altKey: key.alt ?? false,
		bubbles: true,
		cancelable: true,
	})
	target.dispatchEvent(event)
	return event.defaultPrevented
}

/** A paste on `document`, as a browser fires one where no field has focus. */
const dispatchPaste = (text: string, files: ReadonlyArray<File>): boolean => {
	const target: EventTarget | undefined = globalThis.document
	if (target === undefined) return false
	const clipboardData = {
		files,
		items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
		types: [...(text === "" ? [] : ["text/plain"]), ...(files.length > 0 ? ["Files"] : [])],
		getData: (format: string) => (format === "text/plain" || format === "text" ? text : ""),
	}
	const event = Object.assign(new Event("paste", { bubbles: true, cancelable: true }), { clipboardData })
	target.dispatchEvent(event)
	return event.defaultPrevented
}

const MIME_TYPES = new Map([
	["png", "image/png"],
	["jpg", "image/jpeg"],
	["jpeg", "image/jpeg"],
	["gif", "image/gif"],
	["webp", "image/webp"],
	["heic", "image/heic"],
	["svg", "image/svg+xml"],
	["pdf", "application/pdf"],
	["txt", "text/plain"],
	["json", "application/json"],
	["mp4", "video/mp4"],
	["mov", "video/quicktime"],
	["mp3", "audio/mpeg"],
	["zip", "application/zip"],
])

/** A picked file's type from its extension, as a browser reports `File.type`. */
const mimeOf = (file: string): string => MIME_TYPES.get(file.split(".").pop()?.toLowerCase() ?? "") ?? ""

const fakeEvent = (event: Extract<HostToRuntime, { t: "event" }>) => {
	const files: Array<File> = []
	const eventTarget = { value: event.value ?? "", scrollTop: 0, open: false, files }
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
		propagationStopped: false,
		preventDefault() {
			this.defaultPrevented = true
		},
		stopPropagation() {
			this.propagationStopped = true
		},
	}
}

type HostEvent = ReturnType<typeof fakeEvent>

type Handler = (event: HostEvent | Event) => void

/** An element's own wire fields, everything but its hash and children. */
type ElementFields = {
	tag: string
	key?: string
	st: Style
	attrs: Record<string, string>
	on: Record<string, number>
	mount?: string
	o?: 1
	ov?: OverlayWire
}

/** One element as the last commit serialized it, with what it recorded on the way. */
type CachedElement = {
	readonly vnode: AnyVNode
	readonly path: string
	readonly parentPath: string | undefined
	readonly tag: string
	readonly attrs: Record<string, string>
	readonly classes: ReadonlyArray<string>
	readonly id: string | undefined
	readonly h: string
	readonly handlers: ReadonlyArray<readonly [number, Handler]>
	/** Its element children's paths, each with an entry of its own. */
	readonly children: ReadonlyArray<string>
	readonly scopeId: number
	readonly index: number | undefined
	readonly count: number | undefined
	readonly context: string
	/** The pointer-tracking Mount above it, which its `data-hover-report` names. */
	readonly pointerMount: string | undefined
}

/** A Mount watching pointer events below it, and the selector of the elements it looks for. */
type PointerWatch = { readonly mount: string; readonly selector: string }

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
	/** Sends one message; may answer how many characters it wrote, for the commit's stats. */
	readonly send: (message: RuntimeToHost) => number | void
	readonly onStats?: (stats: CommitStats) => void
	readonly onRelease?: () => void
	/** Overlays the app's overlay helpers asked for (portals, anchors, modals), drawn by the host. */
	readonly overlays?: Overlays
	/** Element proxies for geometry-observing Mounts; without it no Mount is acquired. */
	readonly bridge?: ElementBridge
	/** The text a DOM-backed Mount (an editor) currently holds, drawn as a native text field. */
	readonly editableText?: (path: string) => string | undefined
	/** Where the editor's caret is in that text (UTF-16 code units): the field takes it with the text. */
	readonly editableCaret?: (path: string) => number | undefined
	/** The class of the element a DOM-backed Mount edits in (the editor's root), styled onto the field. */
	readonly editableClass?: (path: string) => string | undefined
	/** A native text field over a DOM-backed Mount was edited, or a key was pressed in it. */
	/** A press on a link whose click handler let it through: follow `href`. */
	readonly onLink?: (href: string) => void
	/**
	 * The page's own theme, as its root's class says (`<html class="dark">`), when it sets one:
	 * the app's resolved theme (Light, Dark, or System from the host's appearance). Without one,
	 * the host's appearance (`env.dark`).
	 */
	readonly theme?: () => "dark" | "light" | undefined
	readonly onEditable?: (
		path: string,
		event: { readonly value?: string; readonly key?: string; readonly before?: string },
	) => void
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
	// Moves the window, as Tauri's own attribute does: the host makes the element a drag region.
	"data-tauri-drag-region",
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

type ChildInfo = { readonly vnode: AnyVNode; readonly info: NodeInfo }

/**
 * A VNode's element children (text and comment nodes skipped) as selectors see them. Built once
 * per VNode: a render never changes one it has returned, and an unchanged subtree is the same
 * objects commit after commit.
 */
const childInfos = new WeakMap<object, ReadonlyArray<ChildInfo>>()
const elementChildren = (vnode: AnyVNode): ReadonlyArray<ChildInfo> => {
	const known = childInfos.get(vnode)
	if (known !== undefined) return known
	const kids = (vnode.children ?? []).filter(
		(child): child is AnyVNode =>
			typeof child !== "string" && child.sel !== undefined && child.sel !== "!",
	)
	const infos = kids.map((child, index) => ({
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
	childInfos.set(vnode, infos)
	return infos
}

/**
 * Whether anything below a VNode matches, by VNode and matcher. A cached style re-asks its
 * `:has()` on every commit with the matcher it was computed with, so below an unchanged VNode
 * the answer is the one already given, without walking it again.
 */
const descendantAnswers = new WeakMap<object, WeakMap<object, boolean>>()
const anyDescendant = (vnode: AnyVNode, match: (node: NodeInfo) => boolean): boolean => {
	let answers = descendantAnswers.get(vnode)
	const known = answers?.get(match)
	if (known !== undefined) return known
	const found = elementChildren(vnode).some(
		(child) => match(child.info) || anyDescendant(child.vnode, match),
	)
	if (answers === undefined) {
		answers = new WeakMap()
		descendantAnswers.set(vnode, answers)
	}
	answers.set(match, found)
	return found
}

const hasDescendant =
	(vnode: AnyVNode) =>
	(match: (node: NodeInfo) => boolean, childrenOnly = false): boolean =>
		childrenOnly ? elementChildren(vnode).some((child) => match(child.info)) : anyDescendant(vnode, match)

/**
 * A Foldkit RenderTarget that resolves each committed Document to the native host's wire tree.
 * Handler ids are stable per element path, so an unchanged subtree hashes the same between
 * commits and goes over the wire as a reference.
 */
/** How long a panel stays hidden waiting for its trigger's width before it shows without it. */
const TRIGGER_WIDTH_WAIT_MS = 150

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
	/** The last tree sent: its root, the newest event it acknowledged, and the page around it. */
	let sent:
		| {
				readonly rootHash: string | undefined
				readonly ack: number
				readonly title: string
				readonly page: { readonly bg?: string; readonly color?: string }
		  }
		| undefined
	/**
	 * Last commit's elements by path, for reuse: an element whose VNode is the same object, in the
	 * same scope, place and context, sends its last hash and replays what it recorded.
	 */
	let subtreeCache = new Map<string, CachedElement>()
	/** VNodes whose classes the last commit collected: the same object needs no second look. */
	let seenVnodes = new WeakSet<object>()
	let lastDocument: Document | undefined
	let ack = 0
	/** The newest host event the last committed document reflects. */
	let lastDocumentAck = 0
	/** Triggers whose first width a panel waits for (`--trigger-width`), with that trigger's id. */
	const awaitedWidths = new Map<string, string>()
	/** Panels whose trigger width just arrived: the next commit serializes them again. */
	const widthArrived = new Set<string>()
	/** When each awaited trigger width was first asked for: past a short wait the panel shows anyway. */
	const awaitedSince = new Map<string, number>()
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
		if (typeof vnode === "string" || seenVnodes.has(vnode)) return
		for (const name of classesOf(vnode)) into.add(name)
		for (const child of vnode.children ?? []) collectClasses(child, into)
	}

	/** Dark when the page's theme says so, else when the host's appearance is. */
	const isDark = () => {
		const theme = options.theme?.()
		return theme === undefined ? env.dark : theme === "dark"
	}

	const commitDocument = (document: Document, documentAck: number) => {
		const dark = isDark()
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
		const classesDone = performance.now()

		/**
		 * What anchoring does to a panel's inline style in the browser: it shows a panel its view
		 * hid until positioned, and sets `--trigger-width` once the host has laid the trigger out.
		 */
		const anchoredInline = (path: string, inline: Record<string, string> | undefined) => {
			const anchor = options.overlays?.anchorAt(path)
			if (anchor === undefined) return inline
			const { visibility: _hidden, ...shown } = inline ?? {}
			const trigger = anchor.isTriggerWidthSet ? pathsById.get(anchor.triggerId) : undefined
			if (trigger === undefined) return shown
			const width = options.bridge?.widthOf(trigger)
			// Until the host reports the trigger's width, the panel stays hidden, as the browser
			// keeps it until positioned: drawn at another width it would jump on the next frame.
			// A width that never comes (a trigger laid out before it was observed) shows it anyway.
			if (width === undefined) {
				awaitedWidths.set(trigger, anchor.triggerId)
				const since = awaitedSince.get(trigger)
				if (since === undefined) {
					awaitedSince.set(trigger, performance.now())
					setTimeout(() => {
						for (const panel of options.overlays?.anchoredTo(anchor.triggerId) ?? [])
							widthArrived.add(panel)
						refreshObserved()
					}, TRIGGER_WIDTH_WAIT_MS)
				}
				if (since === undefined || performance.now() - since < TRIGGER_WIDTH_WAIT_MS)
					return { ...shown, visibility: "hidden" }
				return shown
			}
			awaitedSince.delete(trigger)
			return { ...shown, "--trigger-width": `${width}px`, "--button-width": `${width}px` }
		}
		const records = new Map<
			string,
			Parameters<ElementBridge["commit"]>[0] extends Map<string, infer R> ? R : never
		>()
		const mountVNodes = new Map<string, AnyVNode>()
		// A trigger comes before the overlay anchored to it: ids seen so far, by path.
		const pathsById = new Map<string, string>()
		const nextHandlers = new Map<number, Handler>()
		const nextHashes = new Set<string>()
		const nextCache = new Map<string, CachedElement>()
		const nextSeen = new WeakSet<object>()
		let nodes = 0
		let reusedSubtrees = 0
		// What an element's output depends on beyond its VNode, scope and place.
		const context = `${dark}|${env.width}x${env.height}`
		// Overlay and observation changes touch only the elements they name: a cached subtree
		// holding one of those paths is serialized again, the rest is reused.
		const touched = [
			...(options.overlays?.takeChanges() ?? []),
			...(options.bridge?.takeObservedChanges() ?? []),
			...(options.bridge?.takeRestyled() ?? []),
			...widthArrived,
		]
		widthArrived.clear()
		const isTouched = (path: string) =>
			touched.length > 0 && touched.some((p) => p === path || p.startsWith(`${path}/`))

		/** An unchanged element, again: its records, handlers, ids and hashes, and its children's. */
		const replay = (entry: CachedElement) => {
			nodes += 1
			nextSeen.add(entry.vnode)
			if (entry.id !== undefined) pathsById.set(entry.id, entry.path)
			options.bridge?.recordElement(
				entry.path,
				entry.parentPath,
				entry.tag,
				entry.attrs,
				entry.classes,
				records,
			)
			if (entry.vnode.data?.foldkitMount !== undefined) mountVNodes.set(entry.path, entry.vnode)
			for (const [id, handler] of entry.handlers) nextHandlers.set(id, handler)
			nextHashes.add(entry.h)
			nextCache.set(entry.path, entry)
			for (const child of entry.children) {
				const childEntry = subtreeCache.get(child)
				if (childEntry !== undefined) replay(childEntry)
			}
		}

		/**
		 * `prevSame`: every element before this one among its siblings is the same VNode as last
		 * commit, so sibling selectors (`peer-*`, `[&+x]`) see what they saw then.
		 */
		const serialize = (
			vnode: AnyVNode | string,
			path: string,
			parentPath: string | undefined,
			scope: Scope,
			position: { siblings: ReadonlyArray<NodeInfo>; index: number } | undefined,
			prevSame: boolean,
			pointer: PointerWatch | undefined,
		): WireNode => {
			if (typeof vnode === "string") return { k: "t", s: vnode }
			if (vnode.sel === undefined) return { k: "t", s: vnode.text ?? "" }
			// What the parent read of this element for its children's selectors, when it has one.
			const own = position?.siblings[position.index]
			const tag = own?.tag ?? tagOf(vnode)
			if (NON_VISUAL_TAGS.has(tag)) return { k: "t", s: "" }
			const last = subtreeCache.get(path)
			if (
				last !== undefined &&
				prevSame &&
				last.vnode === vnode &&
				last.scopeId === scope.id &&
				last.index === position?.index &&
				last.count === position?.siblings.length &&
				last.context === context &&
				!isTouched(path) &&
				last.pointerMount === pointer?.mount &&
				sentHashes.has(last.h)
			) {
				replay(last)
				reusedSubtrees += 1
				return { k: "r", h: last.h }
			}
			nodes += 1
			nextSeen.add(vnode)
			const attrs = own?.attrs ?? attrsOf(vnode)
			// Before the children: an overlay may render inside its own trigger.
			if (attrs.id !== undefined) pathsById.set(attrs.id, path)
			const classes = own?.classes ?? classesOf(vnode)
			options.bridge?.recordElement(path, parentPath, tag, attrs, classes, records)
			if (vnode.data?.foldkitMount !== undefined) mountVNodes.set(path, vnode)
			// What a Mount wrote on the element's `style` wins over the view's, as in the DOM.
			const written = options.bridge?.styleAt(path)
			const inline = anchoredInline(
				path,
				written === undefined ? inlineStyleOf(vnode) : { ...inlineStyleOf(vnode), ...written },
			)
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
					empty: own?.empty ?? isEmpty(vnode),
					hasDescendant: hasDescendant(vnode),
				},
				scope,
				dark,
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
				nextCache.set(path, {
					vnode,
					path,
					parentPath,
					tag,
					attrs,
					classes,
					id: attrs.id,
					h,
					handlers: [],
					children: [],
					scopeId: scope.id,
					index: position?.index,
					count: position?.siblings.length,
					context,
					pointerMount: pointer?.mount,
				})
				if (sentHashes.has(h)) {
					reusedSubtrees += 1
					return { k: "r", h }
				}
				return par === undefined
					? { k: "svg", h, view, body, st: sized }
					: { k: "svg", h, view, body, st: sized, par }
			}
			const on: Record<string, number> = {}
			const ownHandlers: Array<[number, Handler]> = []
			for (const event in vnode.data?.on) {
				const fn = vnode.data.on[event]
				const id = handlerId(path, event)
				const handler: Handler = (e) => (Array.isArray(fn) ? fn.forEach((f) => f(e)) : fn?.(e))
				nextHandlers.set(id, handler)
				ownHandlers.push([id, handler])
				on[event] = id
			}
			const keep: Record<string, string> = {}
			for (const name of HOST_ATTRS) if (name in attrs) keep[name] = attrs[name] as string
			// A Mount that delegates pointer events: its element and the ones it looks for report them.
			const watchSelector = options.bridge?.pointerSelector(vnode.data?.foldkitMount?.name ?? "")
			const watch = watchSelector === undefined ? pointer : { mount: path, selector: watchSelector }
			if (
				watch !== undefined &&
				(watch.mount === path || matchesElement({ tag, attrs, classes }, watch.selector))
			)
				keep["data-hover-report"] = watch.mount
			const siblings = elementChildren(vnode)
			const infoOf = new Map(siblings.map((sib) => [sib.vnode, sib.info]))
			const infos = siblings.map((sib) => sib.info)
			const children: Array<WireNode> = []
			const childPaths: Array<string> = []
			const childList = vnode.children ?? []
			let siblingsSame = true
			for (let index = 0; index < childList.length; index++) {
				const child = childList[index] as AnyVNode | string
				const segment =
					typeof child !== "string" && child.key !== undefined ? `k${child.key}` : `${index}`
				const childPath = `${path}/${segment}`
				const info = typeof child === "string" ? undefined : infoOf.get(child)
				const position = info === undefined ? undefined : { siblings: infos, index: info.index ?? 0 }
				children.push(
					serialize(child, childPath, path, resolved.scope, position, siblingsSame, watch),
				)
				if (info !== undefined) {
					childPaths.push(childPath)
					siblingsSame &&= subtreeCache.get(childPath)?.vnode === child
				}
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
				const caret = options.editableCaret?.(path)
				if (caret !== undefined) keep["data-caret"] = String(caret)
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
						dark,
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
			const ov = options.overlays?.wireFor(path, (id) => pathsById.get(id))
			if (ov !== undefined) self.ov = ov
			const h = hash(
				JSON.stringify(self) +
					children.map((c) => ("h" in c ? c.h : c.k === "t" ? c.s : "")).join("\u0000"),
			)
			nextHashes.add(h)
			// An editor's text and an anchored panel's trigger width change with no VNode of theirs.
			const isVolatile =
				(mount !== undefined && options.bridge?.isDomMount(mount) === true) ||
				options.overlays?.anchorAt(path) !== undefined ||
				childPaths.some((child) => !nextCache.has(child))
			if (!isVolatile)
				nextCache.set(path, {
					vnode,
					path,
					parentPath,
					tag,
					attrs,
					classes,
					id: attrs.id,
					h,
					handlers: ownHandlers,
					children: childPaths,
					scopeId: scope.id,
					index: position?.index,
					count: position?.siblings.length,
					context,
					pointerMount: pointer?.mount,
				})
			if (sentHashes.has(h)) {
				reusedSubtrees += 1
				return { k: "r", h }
			}
			return { k: "e", h, ...self, c: children }
		}

		const root: WireNode =
			body === null
				? { k: "t", s: "" }
				: serialize(body, "r", undefined, styles.rootScope(dark), undefined, true, undefined)
		handlers = nextHandlers
		const treeDone = performance.now()
		const previouslySent = sentHashes
		sentHashes = nextHashes
		subtreeCache = nextCache
		seenVnodes = nextSeen
		// An overlay's Mount just started: it portals and anchors its panel, so hold this tree
		// and send the next, rather than draw the panel unpositioned for a frame.
		const startedMount = options.bridge?.commit(records, mountVNodes) === true
		const mountsDone = performance.now()
		if (startedMount && !isHoldingForMount) {
			// Held: the host still shows the last tree it was sent, and presses on it run that
			// tree's handlers.
			sentHashes = previouslySent
			isHoldingForMount = true
			setImmediate(() => {
				isHoldingForMount = false
				if (lastDocument) commitDocument(lastDocument, lastDocumentAck)
			})
			return
		}
		const page = styles.pageStyle(dark)
		// The tree the host already shows, with no event of its to acknowledge: a scroll or a
		// layout report the view answered with the same thing. Nothing to send or draw; presses on
		// the tree on screen run this render's handlers.
		const isUnchanged =
			root.k === "r" &&
			sent !== undefined &&
			root.h === sent.rootHash &&
			documentAck === sent.ack &&
			document.title === sent.title &&
			page.bg === sent.page.bg &&
			page.color === sent.page.color
		let bytes = 0
		if (isUnchanged) handlersByGen.set(gen, nextHandlers)
		else {
			gen += 1
			handlersByGen.set(gen, nextHandlers)
			handlersByGen.delete(gen - HANDLER_GENERATIONS)
			const message: RuntimeToHost = {
				t: "tree",
				ack: documentAck,
				gen,
				title: document.title,
				page,
				root,
			}
			const written = send(message)
			// A transport that serializes says how much it wrote; only a stats reader pays for it otherwise.
			if (typeof written === "number") bytes = written
			else if (options.onStats !== undefined) bytes = JSON.stringify(message).length
			sent = {
				rootHash: root.k === "t" ? undefined : root.h,
				ack: documentAck,
				title: document.title,
				page,
			}
		}
		const sendDone = performance.now()
		options.onStats?.({
			phases: {
				classesMs: classesDone - started,
				treeMs: treeDone - classesDone,
				mountsMs: mountsDone - treeDone,
				sendMs: sendDone - mountsDone,
			},
			viewMs,
			styleAndSerializeMs: performance.now() - started,
			bytes,
			nodes,
			reusedSubtrees,
			handlers: nextHandlers.size,
			skipped: isUnchanged,
		})
	}

	/** Runs the element at `path`'s handler for `event`, as `element.dispatchEvent` would. */
	const fire = (path: string, event: HostEvent | Event): void => {
		const id = handlerIds.get(`${path}#${event.type}`)
		const handler = id === undefined ? undefined : handlers.get(id)
		handler?.(event)
	}
	const click = (path: string): void =>
		fire(path, fakeEvent({ t: "event", seq: ack, id: 0, type: "click" }))

	/** Open dialogs by id: what releases each one's portal, modal and dismissal. */
	const openDialogs = new Map<string, () => void>()

	const dom = (bridge: ElementBridge): TargetDomEffects => {
		const withPath = (selector: string, run: (path: string) => void): boolean => {
			const path = bridge.findPath(selector)
			if (path === undefined) return false
			run(path)
			return true
		}
		const focusPath = (path: string) =>
			send({ t: "focus", key: hostFocusKey(path, bridge.tagAt(path), bridge.attrsAt(path)) })
		return {
			focus: (selector) => withPath(selector, focusPath),
			click: (selector) => withPath(selector, click),
			scrollIntoView: (selector, block) =>
				withPath(selector, (path) => send({ t: "reveal", path, block })),
			advanceFocus: (selector, direction) =>
				withPath(selector, (path) => {
					const order = bridge.tabbablePaths()
					const at = order.indexOf(path)
					const next = at === -1 ? undefined : order[direction === "Next" ? at + 1 : at - 1]
					if (next !== undefined) focusPath(next)
				}),
			// Drawn at the window's root; modal, the page behind goes inert and Escape fires the
			// dialog's `cancel`, as `Dom.showDialog` does. Focus goes to `focusSelector` or the
			// first control inside.
			showDialog: (selector, { focusSelector, isModal }) => {
				const path = bridge.findPath(selector)
				if (path === undefined) return undefined
				const id = bridge.idAt(path) ?? path
				if (openDialogs.has(id)) return false
				const overlays = options.overlays
				const releases = [
					overlays?.portal(path),
					isModal ? overlays?.modal(path) : undefined,
					// Foldkit's Dialog closes on the CustomEvent `Dom.showDialog` sends for Escape.
					overlays?.onDismiss(path, () =>
						fire(path, new CustomEvent("cancel", { cancelable: true })),
					),
				]
				openDialogs.set(id, () => {
					for (const release of releases) release?.()
				})
				const inside = (candidate: string) => candidate.startsWith(`${path}/`)
				const wanted = focusSelector === undefined ? undefined : bridge.findPath(focusSelector)
				const initial =
					wanted !== undefined && inside(wanted) ? wanted : bridge.tabbablePaths().find(inside)
				if (initial !== undefined) focusPath(initial)
				return true
			},
			closeDialog: (selector) => {
				const path = bridge.findPath(selector)
				return path === undefined ? undefined : releaseDialog(bridge.idAt(path) ?? path)
			},
			releaseDialog,
		}
	}

	const releaseDialog = (id: string): boolean => {
		const release = openDialogs.get(id)
		if (release === undefined) return false
		openDialogs.delete(id)
		release()
		return true
	}

	const baseTarget: RenderTarget = {
		id: "foldkit-rune",
		commit: (document) => {
			// Messages dispatch synchronously, so a new document reflects every event received.
			lastDocument = document
			lastDocumentAck = ack
			commitDocument(document, ack)
		},
		requestFrame: (frame) => {
			isFramePending = true
			// Not a 0 ms timer: Bun fires one about 1 ms late, which every key and frame would wait out.
			setImmediate(() => {
				isFramePending = false
				frameStartedAt = performance.now()
				frame()
			})
		},
		release: () => options.onRelease?.(),
	}
	const target: RenderTarget =
		options.bridge === undefined ? baseTarget : { ...baseTarget, dom: dom(options.bridge) }

	const handleHostMessage = (message: HostToRuntime) => {
		if (message.t === "env") {
			Object.assign(env, { width: message.width, height: message.height, dark: message.dark })
			// Styles depend on the window and theme, not the Model: re-resolve what is on screen.
			if (lastDocument) {
				sentHashes = new Set()
				subtreeCache = new Map()
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
			// A trigger's first width: the panel anchored to it takes it as `--trigger-width`.
			const triggerId = awaitedWidths.get(message.path)
			if (triggerId !== undefined) {
				awaitedWidths.delete(message.path)
				// The panel waiting on it was cached hidden: it is no change of overlay or observation.
				for (const panel of options.overlays?.anchoredTo(triggerId) ?? []) widthArrived.add(panel)
				refreshObserved()
			}
			return
		}
		if (message.t === "pointer") {
			options.bridge?.dispatchPointer(message)
			return
		}
		if (message.t === "files") {
			void filesPicked(message.path, message.files)
			return
		}
		if (message.t === "paste") {
			void pasted(message)
			return
		}
		if (message.t === "label") {
			activateLabel(message.path)
			return
		}
		if (message.t === "radio") {
			stepRadio(message.path, message.step)
			return
		}
		if (message.t === "key") {
			const prevented = dispatchDocumentKey(message)
			if (message.key === "Escape" && !prevented) options.overlays?.dismissTopmost()
			return
		}
		if (message.t === "contextmenu") {
			options.bridge?.dispatchContextMenu(message)
			return
		}
		if (message.t === "dismiss") {
			options.overlays?.dismissed(message.path)
			return
		}
		if (message.t === "scrolled") {
			options.bridge?.reportScroll(message.path, message.top, message.seq)
			return
		}
		if (message.t !== "event") return
		ack = Math.max(ack, message.seq)
		if (message.type === "editable" && message.path !== undefined) {
			options.onEditable?.(message.path, {
				value: message.value,
				key: message.key,
				before: message.before,
			})
			return
		}
		// A press on a tree no longer kept is dropped: the newest handler may be a different action.
		const presented = message.gen === undefined ? handlers : handlersByGen.get(message.gen)
		const handler = presented?.get(message.id)
		const event = fakeEvent(message)
		handler?.(event)
		// A keydown bubbles through the handlers around its target, then to `document`, then takes
		// its default action.
		for (const id of message.chain ?? []) {
			if (event.propagationStopped) break
			presented?.get(id)?.(event)
		}
		if (message.type === "keydown" && !event.propagationStopped && dispatchDocumentKey(message))
			event.preventDefault()
		if (message.type === "keydown" && process.env.NATIVE_DEBUG)
			console.error(
				`[key] ${message.key} ${[message.id, ...(message.chain ?? [])].join(">")} prevented=${event.defaultPrevented}`,
			)
		if (message.type === "keydown" && message.key === "Escape" && !event.defaultPrevented)
			options.overlays?.dismissTopmost()
		// A click on a link carries its `href`: the browser follows it unless the handler prevented that.
		if (message.type === "click" && message.href !== undefined && !event.defaultPrevented)
			options.onLink?.(message.href)
	}

	/** A Mount that starts observing an element after a commit needs it flagged for the host. */
	let isRefreshScheduled = false
	// An overlay opened or closed in a Mount: the host must draw it.
	options.overlays?.onChange(() => refreshObserved())

	// A precompiled sheet compiles classes it lacked off the input path: restyle once they are in.
	styles.onRecompiled(() => {
		if (lastDocument) commitDocument(lastDocument, lastDocumentAck)
	})

	/** A frame requested and not yet run: it will commit, so a refresh need not. */
	let isFramePending = false
	/** A tree held while an overlay's Mount positions its panel (`commitDocument`). */
	let isHoldingForMount = false
	const refreshObserved = () => {
		if (isRefreshScheduled || lastDocument === undefined) return
		isRefreshScheduled = true
		setImmediate(() => {
			isRefreshScheduled = false
			// A frame on its way commits a newer document with the same changes: committing the
			// last one first would only delay it.
			if (lastDocument && !isFramePending) commitDocument(lastDocument, lastDocumentAck)
		})
	}

	/**
	 * `element.click()`: a file input asks the host for an Open dialog, as a browser shows its
	 * file chooser; any other element runs its click handler.
	 */
	const clickElement = (path: string): void => {
		const attrs = options.bridge?.attrsAt(path) ?? {}
		if (options.bridge?.tagAt(path) === "input" && attrs.type === "file")
			send({ t: "pickFile", path, accept: attrs.accept ?? "" })
		else click(path)
	}

	/**
	 * A browser's label activation: a text field takes focus; a checkbox or radio is clicked
	 * and changes, unless it is a checked radio; a button is clicked.
	 */
	const activateLabel = (path: string) => {
		const control = options.bridge?.labelControl(path)
		if (control === undefined || options.bridge === undefined) return
		const tag = options.bridge.tagAt(control)
		const attrs = options.bridge.attrsAt(control)
		if ("disabled" in attrs) return
		const focusKey = hostFocusKey(control, tag, attrs)
		if (focusKey !== control) {
			send({ t: "focus", key: focusKey })
			return
		}
		click(control)
		const checkable = tag === "input" && (attrs.type === "checkbox" || attrs.type === "radio")
		if (checkable && !(attrs.type === "radio" && "checked" in attrs))
			fire(
				control,
				fakeEvent({ t: "event", seq: ack, id: 0, type: "change", value: attrs.value ?? "" }),
			)
		if (checkable) send({ t: "focus", key: control })
	}

	/**
	 * A browser's radio group keys: an arrow moves to the next radio with the same `name`
	 * (wrapping), checks it (its `change`) and focuses it.
	 */
	const stepRadio = (path: string, step: 1 | -1) => {
		const group = options.bridge?.radioGroup(path) ?? []
		const at = group.indexOf(path)
		const next = group[(at + step + group.length) % group.length]
		if (at === -1 || next === undefined || next === path) return
		const value = options.bridge?.attrsAt(next).value ?? ""
		fire(next, fakeEvent({ t: "event", seq: ack, id: 0, type: "change", value }))
		send({ t: "focus", key: hostFocusKey(next, "input", { type: "radio" }) })
	}

	/**
	 * Files the host names by path, read. Only a host with a file system sends paths, so the runtime
	 * loads anywhere else.
	 */
	const readFiles = async (paths: ReadonlyArray<string>) => {
		if (paths.length === 0) return []
		const [{ readFile }, { basename }] = await Promise.all([
			import("node:fs/promises"),
			import("node:path"),
		])
		return Promise.all(
			paths.map(
				async (file) => new File([await readFile(file)], basename(file), { type: mimeOf(file) }),
			),
		)
	}

	/** The files picked for a file input: read, then its `change`, as a browser fires it. */
	const filesPicked = async (path: string, paths: ReadonlyArray<string>) => {
		if (paths.length === 0) return
		const files = await readFiles(paths)
		const target = { files, value: "", scrollTop: 0, open: false }
		fire(path, {
			...fakeEvent({ t: "event", seq: ack, id: 0, type: "change" }),
			target,
			currentTarget: target,
		})
	}

	/** A paste replays as the DOM's `paste` on `document`, with the clipboard as `clipboardData`. */
	const pasted = async (paste: Extract<HostToRuntime, { t: "paste" }>) => {
		const picked = await readFiles(paste.files)
		const image =
			paste.image == null
				? []
				: [
						new File([Uint8Array.from(atob(paste.image), (c) => c.charCodeAt(0))], "image.png", {
							type: "image/png",
						}),
					]
		dispatchPaste(paste.text, picked.length > 0 ? picked : image)
	}

	return { target, handleHostMessage, env, refreshObserved, click: clickElement, filesPicked, fire }
}
