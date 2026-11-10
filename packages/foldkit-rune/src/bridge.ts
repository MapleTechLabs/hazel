/**
 * Element proxies for Mounts that observe geometry (a virtualized list measuring itself). Each
 * proxy stands for one element path; its size and scroll position come from the native host's
 * layout, and ResizeObserver, IntersectionObserver, MutationObserver and `scroll` events fire from
 * host reports. Only Mounts named in `mounts` are acquired: the rest need real DOM and stay inert.
 * An `<iframe>`'s proxy has a `contentWindow`: the host shows the frame's page in a web view.
 */
import type { FrameData, HostToRuntime, RuntimeToHost } from "./wire"

type Rect = { x: number; y: number; width: number; height: number }

type ElementRecord = {
	path: string
	parent: string | undefined
	tag: string
	attrs: Record<string, string>
	classes: ReadonlyArray<string>
	childPaths: Array<string>
}

type AnyVNode = {
	elm?: unknown
	data?: {
		hook?: {
			insert?: (vnode: AnyVNode) => void
			postpatch?: (previous: AnyVNode, vnode: AnyVNode) => void
			destroy?: (vnode: AnyVNode) => void
		}
		foldkitMount?: { name?: string; args?: Record<string, unknown> }
	}
}

/** The element surface a geometry Mount reads, backed by host layout. */
type ProxyElement = EventTarget & {
	readonly __path: string
	readonly id: string
	readonly tagName: string
	readonly isConnected: boolean
	readonly clientWidth: number
	readonly clientHeight: number
	readonly offsetWidth: number
	readonly offsetHeight: number
	readonly scrollHeight: number
	scrollTop: number
	readonly dataset: Record<string, string>
	getBoundingClientRect(): Rect & { top: number; left: number; right: number; bottom: number }
	getAttribute(name: string): string | null
	hasAttribute(name: string): boolean
	querySelectorAll(selector: string): Array<ProxyElement>
	querySelector(selector: string): ProxyElement | null
	closest(selector: string): ProxyElement | null
	/** `null` above the root, as the browser's, so an ancestor walk ends. */
	readonly parentElement: ProxyElement | null
	contains(other: EventTarget | null): boolean
	scrollTo(arg: { top?: number } | number, y?: number): void
	scrollIntoView(arg?: boolean | { block?: HostReveal["block"] }): void
	focus(): void
	blur(): void
	/**
	 * Writes are kept by path and drawn only for a `styledMounts` Mount's element: the view's
	 * classes and the host's layout place every other one.
	 */
	readonly style: Record<string, unknown>
	remove(): void
	/** An `<iframe>`'s window: the same object for as long as the frame's path lives. */
	readonly contentWindow: FrameWindow | null
}

/** What the app does with a framed page's window: post to it, and tell its messages by identity. */
type FrameWindow = { postMessage(data: FrameData, targetOrigin?: string): void }

type ResizeEntry = {
	readonly target: ProxyElement
	readonly contentRect: Rect
	readonly borderBoxSize: ReadonlyArray<{ inlineSize: number; blockSize: number }>
	readonly contentBoxSize: ReadonlyArray<{ inlineSize: number; blockSize: number }>
}

/**
 * What an element proxy asks of the host: `scrollTop =`, `focus()`, `scrollIntoView()`, and an
 * `<iframe>`'s `contentWindow.postMessage()`.
 */
export type HostElementCommand = Extract<
	RuntimeToHost,
	{ t: "scroll" | "focus" | "reveal" | "measure" | "framePost" }
>

/** `<input>` types the host draws as controls, not text fields (its `is_text_field`). */
const CONTROL_INPUT_TYPES = new Set([
	"checkbox",
	"radio",
	"button",
	"submit",
	"reset",
	"image",
	"range",
	"color",
])

/** The host keys a text field's editor `<path>/field` inside the element at `path`. */
export const hostFocusKey = (
	path: string,
	tag: string | undefined,
	attrs: Readonly<Record<string, string>> = {},
): string => {
	const textField =
		tag === "textarea" || (tag === "input" && !CONTROL_INPUT_TYPES.has(attrs.type ?? "text"))
	return textField ? `${path}/field` : path
}

/** Whether an element (tag, attributes, classes) matches one of the simple selectors Mounts use. */
export const matchesElement = (
	element: { tag: string; attrs: Record<string, string>; classes: ReadonlyArray<string> },
	selector: string,
): boolean => matchesSelector({ path: "", parent: undefined, childPaths: [], ...element }, selector)

type HostReveal = Extract<RuntimeToHost, { t: "reveal" }>

/** `scrollIntoView(alignToTop)` or `scrollIntoView({ block })`, as the DOM reads them. */
const revealBlock = (arg?: boolean | { block?: HostReveal["block"] }): HostReveal["block"] =>
	arg === false ? "end" : typeof arg === "object" ? (arg.block ?? "start") : "start"

const TABBABLE_TAGS = new Set(["button", "input", "select", "textarea"])

const isTabbable = (record: ElementRecord): boolean => {
	if ("disabled" in record.attrs || "inert" in record.attrs) return false
	const tabIndex = record.attrs.tabindex
	if (tabIndex !== undefined) return Number(tabIndex) >= 0
	return TABBABLE_TAGS.has(record.tag) || (record.tag === "a" && "href" in record.attrs)
}

const matchesSelector = (record: ElementRecord, selector: string): boolean => {
	const attr = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(selector)
	if (attr) {
		const [, name, value] = attr
		return value === undefined ? name in record.attrs : record.attrs[name] === value
	}
	// A tag with an attribute (`iframe[data-html-render-id]`).
	const tagged = /^([a-zA-Z][\w-]*)(\[.+\])$/.exec(selector)
	if (tagged) return record.tag === tagged[1]?.toLowerCase() && matchesSelector(record, tagged[2] ?? "")
	if (selector.startsWith("#")) return record.attrs.id === selector.slice(1)
	if (selector.startsWith(".")) return record.classes.includes(selector.slice(1))
	return record.tag === selector.toLowerCase()
}

/** How long a runtime scroll waits for the host to report it before host reports win again. */
const SCROLL_SETTLE_MS = 500

export const makeElementBridge = (options: {
	readonly mounts: ReadonlySet<string>
	/**
	 * Mounts in `mounts` that start as soon as their element is in the tree, not once the host has
	 * laid it out: overlays, which the host places, on a `display: contents` element with no box.
	 */
	readonly immediateMounts?: ReadonlySet<string>
	/**
	 * Mounts that listen for pointer events on their element (delegated `pointerover`), by name,
	 * with the selector of the elements they look for: the host reports the pointer entering and
	 * leaving those, and the Mount's element itself.
	 */
	readonly pointerTargets?: ReadonlyMap<string, string>
	/**
	 * Mounts that need a real DOM (a rich-text editor) get an element from here, typically a
	 * headless DOM's, or `undefined` while it loads. The host draws a native text field in their place.
	 */
	readonly domMounts?: ReadonlyMap<string, () => object | undefined>
	readonly send: (command: HostElementCommand) => void
	/** A new element became observed: the host must start reporting its layout. */
	readonly onObserve?: () => void
	/** A Mount called `remove()` on its element (it had moved it into `<body>`). */
	readonly onRemove?: (path: string) => void
	/** `element.click()` on a proxy: the render target runs its click, or picks a file. */
	readonly onClick?: (path: string) => void
	/**
	 * Mounts that place their own element by writing its inline style (`element.style.top = …`),
	 * by name: what they write is drawn. The host places every other Mount's element.
	 */
	readonly styledMounts?: ReadonlySet<string>
	/** A drawn inline style changed: the tree must be rendered again. */
	readonly onRestyle?: () => void
	/** An element scrolled, after its own `scroll` event: a capturing listener above it hears it. */
	readonly onScroll?: () => void
}) => {
	let records = new Map<string, ElementRecord>()
	const rects = new Map<string, Rect>()
	const scrollTops = new Map<string, number>()
	/** Offsets the runtime set and the host has not drawn yet; older host reports are stale. */
	/** The runtime's own scroll per path, until the host reports it (or the wait runs out). */
	const pendingScrolls = new Map<
		string,
		{ top: number; at: number; seq: number; held?: number; timer?: ReturnType<typeof setTimeout> }
	>()
	let scrollSeq = 0
	const proxies = new Map<string, ProxyElement>()
	const observed = new Set<string>()
	/** Paths observed since the last `takeObservedChanges`: their `o` flag changed. */
	let newlyObserved = new Set<string>()
	/** What was written to each element's `style`, by path and CSS property. */
	const writtenStyles = new Map<string, Map<string, string>>()
	/** Paths whose drawn inline style changed since the last `takeRestyled`. */
	let restyled = new Set<string>()
	const mountNameAt = (path: string) =>
		(mounted.get(path) ?? awaitingLayout.get(path))?.data?.foldkitMount?.name
	const isStyled = (path: string) => options.styledMounts?.has(mountNameAt(path) ?? "") === true
	const restyle = (path: string) => {
		restyled.add(path)
		options.onRestyle?.()
	}
	const writeStyle = (path: string, name: string, value: unknown) => {
		const property = name.startsWith("--") ? name : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
		const text = value === null || value === undefined ? "" : String(value)
		const written = writtenStyles.get(path) ?? new Map<string, string>()
		if ((written.get(property) ?? "") === text) return
		if (text === "") written.delete(property)
		else written.set(property, text)
		writtenStyles.set(path, written)
		restyle(path)
	}
	const readStyle = (path: string, name: string) =>
		writtenStyles
			.get(path)
			?.get(name.startsWith("--") ? name : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)) ?? ""
	const resizeObservers = new Map<string, Set<(target: ProxyElement) => void>>()
	/** By path: each re-checks whether its element meets the window, on every rect the host reports. */
	const intersectionObservers = new Map<string, Set<() => void>>()
	const frameWindows = new Map<string, FrameWindow>()
	const frameWindowFor = (path: string): FrameWindow => {
		const existing = frameWindows.get(path)
		if (existing !== undefined) return existing
		const frameWindow: FrameWindow = {
			postMessage: (data) => options.send({ t: "framePost", path, data }),
		}
		frameWindows.set(path, frameWindow)
		return frameWindow
	}
	const mutationObservers = new Set<() => void>()
	let mounted = new Map<string, AnyVNode>()
	const awaitingLayout = new Map<string, AnyVNode>()
	const domElements = new Map<string, object>()

	/** `observe`: the host must report this element's layout (a Mount will read its geometry). */
	const proxyFor = (path: string, observe = true): ProxyElement => {
		const existing = proxies.get(path)
		if (observe && !observed.has(path)) {
			observed.add(path)
			newlyObserved.add(path)
			// Laid out before it was observed, it reports no layout until it moves: ask for it.
			options.send({ t: "measure", path })
			options.onObserve?.()
		}
		if (existing) return existing
		const ElementClass: new () => EventTarget = globalThis.HTMLElement
		const styleMethods = {
			setProperty: (name: string, value: unknown) => writeStyle(path, name, value),
			removeProperty: (name: string) => writeStyle(path, name, ""),
			getPropertyValue: (name: string) => readStyle(path, name),
		}
		const rect = () => rects.get(path) ?? { x: 0, y: 0, width: 0, height: 0 }
		const record = () => records.get(path)
		const setScrollTop = (top: number) => {
			// A write of the offset it read (an anchor kept with no change) is no move: sending it
			// would put back an offset the user may have scrolled on from.
			if (top === (scrollTops.get(path) ?? 0)) return
			scrollTops.set(path, top)
			clearTimeout(pendingScrolls.get(path)?.timer)
			const seq = ++scrollSeq
			pendingScrolls.set(path, { top, at: performance.now(), seq })
			options.send({ t: "scroll", path, top, seq })
		}
		const proxy = Object.defineProperties(new ElementClass(), {
			__path: { value: path },
			id: { get: () => record()?.attrs.id ?? "" },
			tagName: { get: () => (record()?.tag ?? "div").toUpperCase() },
			isConnected: { get: () => records.has(path) },
			clientWidth: { get: () => rect().width },
			clientHeight: { get: () => rect().height },
			offsetWidth: { get: () => rect().width },
			offsetHeight: { get: () => rect().height },
			scrollHeight: { get: () => rect().height },
			scrollTop: {
				get: () => scrollTops.get(path) ?? 0,
				set: setScrollTop,
			},
			dataset: {
				get: () =>
					Object.fromEntries(
						Object.entries(record()?.attrs ?? {})
							.filter(([name]) => name.startsWith("data-"))
							.map(([name, value]) => [
								name.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase()),
								value,
							]),
					),
			},
			getBoundingClientRect: {
				value: () => {
					const r = rect()
					return { ...r, top: r.y, left: r.x, right: r.x + r.width, bottom: r.y + r.height }
				},
			},
			getAttribute: { value: (name: string) => record()?.attrs[name] ?? null },
			hasAttribute: { value: (name: string) => name in (record()?.attrs ?? {}) },
			querySelectorAll: { value: (selector: string) => queryAll(path, selector) },
			querySelector: { value: (selector: string) => queryAll(path, selector)[0] ?? null },
			closest: { value: (selector: string) => closest(path, selector) },
			parentElement: {
				get: () => {
					const parent = record()?.parent
					// Not observed: an ancestor walk passes many elements and reads few of them.
					return parent === undefined || !records.has(parent) ? null : proxyFor(parent, false)
				},
			},
			contains: {
				value: (other: EventTarget | null) =>
					isProxy(other) && (other.__path === path || other.__path.startsWith(`${path}/`)),
			},
			scrollTo: {
				value: (arg: { top?: number } | number, y?: number) =>
					setScrollTop(typeof arg === "number" ? (y ?? 0) : (arg.top ?? 0)),
			},
			scrollIntoView: {
				value: (arg?: boolean | { block?: HostReveal["block"] }) =>
					options.send({ t: "reveal", path, block: revealBlock(arg) }),
			},
			focus: {
				value: () =>
					options.send({ t: "focus", key: hostFocusKey(path, record()?.tag, record()?.attrs) }),
			},
			click: { value: () => options.onClick?.(path) },
			blur: { value: () => {} },
			style: {
				value: new Proxy(styleMethods, {
					get: (methods, name) => {
						if (typeof name !== "string") return undefined
						if (name === "setProperty") return methods.setProperty
						if (name === "removeProperty") return methods.removeProperty
						if (name === "getPropertyValue") return methods.getPropertyValue
						return readStyle(path, name)
					},
					set: (_, name, value) => {
						if (typeof name === "string") writeStyle(path, name, value)
						return true
					},
				}),
			},
			// A Mount taking its element out of the page (a portal it set up, released).
			remove: { value: () => options.onRemove?.(path) },
			contentWindow: { get: () => (record()?.tag === "iframe" ? frameWindowFor(path) : null) },
		}) as ProxyElement
		proxies.set(path, proxy)
		return proxy
	}

	const isProxy = (value: unknown): value is ProxyElement =>
		typeof value === "object" && value !== null && "__path" in value

	const queryAll = (root: string, selector: string): Array<ProxyElement> => {
		const found: Array<ProxyElement> = []
		const walk = (path: string) => {
			for (const child of records.get(path)?.childPaths ?? []) {
				const record = records.get(child)
				if (record && matchesSelector(record, selector)) found.push(proxyFor(child))
				walk(child)
			}
		}
		walk(root)
		return found
	}

	const closest = (path: string, selector: string): ProxyElement | null => {
		for (
			let current: string | undefined = path;
			current !== undefined;
			current = records.get(current)?.parent
		) {
			const record = records.get(current)
			if (record && matchesSelector(record, selector)) return proxyFor(current)
		}
		return null
	}

	/** Called once per element while the target serializes a commit. */
	const recordElement = (
		path: string,
		parent: string | undefined,
		tag: string,
		attrs: Record<string, string>,
		classes: ReadonlyArray<string>,
		next: Map<string, ElementRecord>,
	) => {
		next.set(path, { path, parent, tag, attrs, classes, childPaths: [] })
		if (parent !== undefined) next.get(parent)?.childPaths.push(path)
	}

	/**
	 * After a commit: acquire new Mounts, re-patch kept ones, release gone ones, notify observers.
	 * Answers whether it started an immediate Mount (an overlay's), which may move its element.
	 */
	const commit = (next: Map<string, ElementRecord>, mountVNodes: Map<string, AnyVNode>): boolean => {
		records = next
		let startedImmediate = false
		const nextMounted = new Map<string, AnyVNode>()
		for (const [path, vnode] of mountVNodes) {
			const name = vnode.data?.foldkitMount?.name ?? ""
			const makeDomElement = options.domMounts?.get(name)
			if (makeDomElement === undefined && !options.mounts.has(name)) continue
			if (makeDomElement !== undefined && !domElements.has(path)) {
				// The factory answers `undefined` until its DOM has loaded: the Mount waits a commit.
				const element = makeDomElement()
				if (element === undefined) continue
				domElements.set(path, element)
			}
			vnode.elm = makeDomElement === undefined ? proxyFor(path) : domElements.get(path)
			const previous = mounted.get(path) ?? awaitingLayout.get(path)
			// A geometry Mount starts once the host has laid its element out, as a browser's
			// element has a size when it is inserted.
			if (makeDomElement === undefined && !rects.has(path) && !options.immediateMounts?.has(name)) {
				awaitingLayout.set(path, vnode)
				continue
			}
			awaitingLayout.delete(path)
			const isSameMount =
				previous !== undefined && mounted.has(path) && previous.data?.foldkitMount?.name === name
			// A different Mount in the same slot releases the old one and starts fresh.
			if (previous !== undefined && mounted.has(path) && !isSameMount)
				previous.data?.hook?.destroy?.(previous)
			if (isSameMount) vnode.data?.hook?.postpatch?.(previous, vnode)
			else {
				vnode.data?.hook?.insert?.(vnode)
				if (options.immediateMounts?.has(name)) startedImmediate = true
			}
			nextMounted.set(path, vnode)
		}
		for (const path of [...awaitingLayout.keys()]) if (!mountVNodes.has(path)) awaitingLayout.delete(path)
		for (const [path, vnode] of mounted) {
			if (nextMounted.has(path)) continue
			vnode.data?.hook?.destroy?.(vnode)
			domElements.delete(path)
			// The next Mount here starts from an element with no style of the last one's.
			writtenStyles.delete(path)
		}
		mounted = nextMounted
		for (const path of [...frameWindows.keys()]) if (!next.has(path)) frameWindows.delete(path)
		for (const notify of mutationObservers) notify()
		return startedImmediate
	}

	/** Host layout: a new rect for an observed element. */
	const reportLayout = (path: string, rect: Rect) => {
		const previous = rects.get(path)
		rects.set(path, rect)
		// Hidden until measured (`styleAt`): its first rect shows it.
		if (previous === undefined && writtenStyles.has(path) && isStyled(path)) restyle(path)
		const waiting = awaitingLayout.get(path)
		if (waiting !== undefined) {
			awaitingLayout.delete(path)
			mounted.set(path, waiting)
			waiting.data?.hook?.insert?.(waiting)
			return
		}
		for (const check of intersectionObservers.get(path) ?? []) check()
		if (previous && previous.width === rect.width && previous.height === rect.height) return
		const proxy = proxies.get(path)
		if (proxy) for (const notify of resizeObservers.get(path) ?? []) notify(proxy)
	}

	/** Viewports whose `scroll` event is due once the current batch of host lines is in. */
	const scrollsToDispatch = new Set<string>()
	const applyScroll = (path: string, top: number) => {
		if (scrollTops.get(path) === top) return
		scrollTops.set(path, top)
		// The host sends a frame's offset before the rects that frame moved: the listener runs
		// once they are all in (the rest of this batch of host lines), as a browser's would.
		if (scrollsToDispatch.has(path)) return
		scrollsToDispatch.add(path)
		queueMicrotask(() => {
			scrollsToDispatch.delete(path)
			proxies.get(path)?.dispatchEvent(new Event("scroll"))
			options.onScroll?.()
		})
	}

	const reportScroll = (path: string, top: number, seq?: number) => {
		const pending = pendingScrolls.get(path)
		// A host that says which scroll it had applied: a report from before ours is stale, any
		// after it is the offset now (the user may have scrolled on), with no wait.
		if (pending !== undefined && seq !== undefined) {
			if (seq < pending.seq) return
			clearTimeout(pending.timer)
			pendingScrolls.delete(path)
			applyScroll(path, top)
			return
		}
		if (pending !== undefined) {
			// The host may clamp the offset; a report near it, or one well after it, ends the wait.
			const waited = performance.now() - pending.at
			const isSettled = Math.abs(top - pending.top) < 2 || waited > SCROLL_SETTLE_MS
			if (!isSettled) {
				// Maybe stale, maybe the clamped answer to this scroll: a still viewport sends no
				// other, so the newest one held back lands when the wait runs out.
				pending.held = top
				pending.timer ??= setTimeout(() => {
					if (pendingScrolls.get(path) !== pending) return
					pendingScrolls.delete(path)
					if (pending.held !== undefined) applyScroll(path, pending.held)
				}, SCROLL_SETTLE_MS - waited)
				return
			}
			clearTimeout(pending.timer)
			pendingScrolls.delete(path)
		}
		applyScroll(path, top)
	}

	/** The element's width as the host last laid it out; asks the host to report it from now on. */
	const widthOf = (path: string): number | undefined => {
		proxyFor(path)
		return rects.get(path)?.width
	}

	/** A host pointer report, as the DOM event a delegated listener on the Mount's element hears. */
	const dispatchPointer = (report: { path: string; mount: string; inside: boolean }) => {
		const root = proxies.get(report.mount)
		if (root === undefined) return
		const PointerEventClass: new (type: string, init?: EventInit) => Event =
			globalThis.PointerEvent ?? Event
		if (report.path === report.mount) {
			const MouseEventClass: new (type: string, init?: EventInit) => Event =
				globalThis.MouseEvent ?? Event
			if (report.inside) {
				root.dispatchEvent(new PointerEventClass("pointerenter"))
				root.dispatchEvent(new MouseEventClass("mouseenter"))
			} else {
				root.dispatchEvent(new PointerEventClass("pointerleave"))
				root.dispatchEvent(new MouseEventClass("mouseleave"))
			}
			return
		}
		if (!report.inside) return
		const event = new PointerEventClass("pointerover", { bubbles: true })
		// The element under the pointer, as the event's target; the listener sits on the Mount's element.
		Object.defineProperty(event, "target", { value: proxyFor(report.path, false) })
		root.dispatchEvent(event)
	}

	/** A host right-click, as the `contextmenu` a listener on the Mount's element hears. */
	const dispatchContextMenu = (report: Extract<HostToRuntime, { t: "contextmenu" }>) => {
		const root = proxies.get(report.mount)
		if (root === undefined) return
		// The listener measures the pointer against the elements around it.
		for (const [path, [x, y, width, height]] of Object.entries(report.rects ?? {}))
			rects.set(path, { x, y, width, height })
		const MouseEventClass: new (type: string, init?: MouseEventInit) => Event =
			globalThis.MouseEvent ?? Event
		const event = new MouseEventClass("contextmenu", {
			bubbles: true,
			cancelable: true,
			button: 2,
			clientX: report.x,
			clientY: report.y,
		})
		Object.defineProperty(event, "target", { value: proxyFor(report.path, false) })
		// Without a MouseEvent class (outside the app's shims) the plain Event carries the point.
		if (!("clientX" in event))
			Object.defineProperties(event, { clientX: { value: report.x }, clientY: { value: report.y } })
		root.dispatchEvent(event)
	}

	/** Every element in document order: each root, then its subtree. */
	const inOrder = (): Array<ElementRecord> => {
		const out: Array<ElementRecord> = []
		const walk = (record: ElementRecord) => {
			out.push(record)
			for (const child of record.childPaths) {
				const next = records.get(child)
				if (next) walk(next)
			}
		}
		for (const record of records.values()) if (record.parent === undefined) walk(record)
		return out
	}

	/** The path of the first element `selector` matches, as `document.querySelector` finds it. */
	const findPath = (selector: string): string | undefined =>
		inOrder().find((record) => matchesSelector(record, selector))?.path

	/** The element's tag, for the host's key of a text field (`<path>/field`). */
	const tagAt = (path: string): string | undefined => records.get(path)?.tag

	/** The element's attributes, as the last commit recorded them. */
	const attrsAt = (path: string): Readonly<Record<string, string>> => records.get(path)?.attrs ?? {}

	/** The element's `id`, which dialogs are known by. */
	const idAt = (path: string): string | undefined => records.get(path)?.attrs.id

	/** Paths of the elements Tab reaches, in document order (positive tabindex aside). */
	const tabbablePaths = (): Array<string> =>
		inOrder()
			.filter(isTabbable)
			.map((record) => record.path)

	/** A label's control: the element its `for` names, else the first control inside it. */
	const labelControl = (path: string): string | undefined => {
		const label = records.get(path)
		if (label === undefined) return undefined
		const target = label.attrs.for
		if (target !== undefined) {
			for (const record of records.values()) if (record.attrs.id === target) return record.path
			return undefined
		}
		const isControl = (r: ElementRecord) =>
			["input", "textarea", "select", "button"].includes(r.tag) && r.attrs.type !== "hidden"
		const search = (at: ElementRecord): string | undefined => {
			for (const child of at.childPaths) {
				const record = records.get(child)
				if (record === undefined) continue
				if (isControl(record)) return record.path
				const found = search(record)
				if (found !== undefined) return found
			}
			return undefined
		}
		return search(label)
	}

	/** The enabled radios sharing the one at `path`'s `name`, in document order. */
	const radioGroup = (path: string): Array<string> => {
		const name = records.get(path)?.attrs.name
		if (name === undefined) return [path]
		return inOrder()
			.filter(
				(r) =>
					r.tag === "input" &&
					r.attrs.type === "radio" &&
					r.attrs.name === name &&
					!("disabled" in r.attrs),
			)
			.map((r) => r.path)
	}

	/** Every element `selector` matches, in document order, as `document.querySelectorAll` finds them. */
	const queryDocument = (selector: string): Array<ProxyElement> =>
		inOrder()
			.filter((record) => matchesSelector(record, selector))
			.map((record) => proxyFor(record.path, false))

	/** The element at `path`, while the tree has it. */
	const proxyAt = (path: string): ProxyElement | null => (records.has(path) ? proxyFor(path, false) : null)

	const findById = (id: string): ProxyElement | null => {
		for (const record of records.values()) if (record.attrs.id === id) return proxyFor(record.path)
		return null
	}

	class BridgeResizeObserver {
		private targets = new Map<string, (target: ProxyElement) => void>()
		constructor(
			private callback: (entries: Array<ResizeEntry>, observer: BridgeResizeObserver) => void,
		) {}
		observe(target: unknown) {
			if (!isProxy(target)) return
			const path = target.__path
			// An element reached by walking (`parentElement`) is not observed yet: its size is asked for.
			proxyFor(path)
			const notify = (proxy: ProxyElement) => {
				const r = rects.get(path) ?? { x: 0, y: 0, width: 0, height: 0 }
				const size = [{ inlineSize: r.width, blockSize: r.height }]
				this.callback(
					[{ target: proxy, contentRect: r, borderBoxSize: size, contentBoxSize: size }],
					this,
				)
			}
			this.targets.set(path, notify)
			const set = resizeObservers.get(path) ?? new Set()
			set.add(notify)
			resizeObservers.set(path, set)
			if (rects.has(path)) queueMicrotask(() => notify(target))
		}
		unobserve(target: unknown) {
			if (!isProxy(target)) return
			const notify = this.targets.get(target.__path)
			if (notify) resizeObservers.get(target.__path)?.delete(notify)
			this.targets.delete(target.__path)
		}
		disconnect() {
			for (const path of [...this.targets.keys()]) this.unobserve(proxies.get(path))
		}
	}

	/**
	 * Against the window, grown above and below by `rootMargin`'s first length: the callback runs
	 * with the first rect the host reports, then whenever the element starts or stops meeting it.
	 */
	class BridgeIntersectionObserver {
		private targets = new Map<string, () => void>()
		private margin: number
		constructor(
			private callback: (
				entries: Array<{ target: ProxyElement; isIntersecting: boolean; intersectionRatio: number }>,
				observer: BridgeIntersectionObserver,
			) => void,
			init?: { rootMargin?: string },
		) {
			this.margin = Number.parseFloat(init?.rootMargin ?? "0") || 0
		}
		observe(target: unknown) {
			if (!isProxy(target) || this.targets.has(target.__path)) return
			const path = target.__path
			proxyFor(path)
			let last: boolean | undefined
			const check = () => {
				const rect = rects.get(path)
				if (rect === undefined) return
				const isIntersecting =
					rect.y + rect.height >= -this.margin && rect.y <= globalThis.innerHeight + this.margin
				if (isIntersecting === last) return
				last = isIntersecting
				this.callback([{ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }], this)
			}
			this.targets.set(path, check)
			const set = intersectionObservers.get(path) ?? new Set()
			set.add(check)
			intersectionObservers.set(path, set)
			if (rects.has(path)) queueMicrotask(check)
		}
		unobserve(target: unknown) {
			if (!isProxy(target)) return
			const check = this.targets.get(target.__path)
			if (check) intersectionObservers.get(target.__path)?.delete(check)
			this.targets.delete(target.__path)
		}
		disconnect() {
			for (const [path, check] of this.targets) intersectionObservers.get(path)?.delete(check)
			this.targets.clear()
		}
		takeRecords() {
			return []
		}
	}

	class BridgeMutationObserver {
		private notify = () => this.callback([], this)
		constructor(private callback: (records: Array<never>, observer: BridgeMutationObserver) => void) {}
		observe(target: unknown) {
			if (isProxy(target)) mutationObservers.add(this.notify)
		}
		disconnect() {
			mutationObservers.delete(this.notify)
		}
		takeRecords() {
			return []
		}
	}

	return {
		recordElement,
		commit,
		reportLayout,
		reportScroll,
		findById,
		queryDocument,
		proxyAt,
		findPath,
		tagAt,
		idAt,
		attrsAt,
		tabbablePaths,
		radioGroup,
		labelControl,
		widthOf,
		dispatchPointer,
		dispatchContextMenu,
		/** The selector of elements a pointer-tracking Mount named `name` watches. */
		pointerSelector: (name: string) => options.pointerTargets?.get(name),
		isObserved: (path: string) => observed.has(path),
		/** How many elements are observed: it only grows, so it versions `isObserved`. */
		get observedCount() {
			return observed.size
		},
		/** The paths observed since the last call, whose wire `o` flag is new. */
		takeObservedChanges: (): ReadonlySet<string> => {
			const changes = newlyObserved
			newlyObserved = new Set()
			return changes
		},
		/**
		 * The inline style a `styledMounts` Mount wrote on its element. An element whose size the
		 * host has not reported yet stays hidden: the Mount placed it from a size of zero, and
		 * places it again when the size arrives.
		 */
		styleAt: (path: string): Record<string, string> | undefined => {
			const written = writtenStyles.get(path)
			if (written === undefined || written.size === 0 || !isStyled(path)) return undefined
			const style = Object.fromEntries(written)
			return observed.has(path) && !rects.has(path) ? { ...style, visibility: "hidden" } : style
		},
		/** The paths whose `styleAt` changed since the last call. */
		takeRestyled: (): ReadonlySet<string> => {
			const changes = restyled
			restyled = new Set()
			return changes
		},
		/**
		 * `getComputedStyle(element).overflowY`, from the element's classes: what an ancestor walk
		 * looking for the nearest scroller reads.
		 */
		overflowYOf: (element: unknown): string => {
			const classes = isProxy(element) ? (records.get(element.__path)?.classes ?? []) : []
			const scrolling = classes.find((name) => /^overflow(-y)?-(auto|scroll)$/.test(name))
			return scrolling === undefined ? "visible" : scrolling.endsWith("scroll") ? "scroll" : "auto"
		},
		/** A DOM-backed Mount at `path`: its name, args and element, for the app's native glue. */
		domMountAt: (path: string) => {
			const vnode = mounted.get(path)
			const element = domElements.get(path)
			const marker = vnode?.data?.foldkitMount
			return marker?.name === undefined || element === undefined
				? undefined
				: { name: marker.name, args: marker.args ?? {}, element }
		},
		isDomMount: (name: string) => options.domMounts?.has(name) ?? false,
		ResizeObserver: BridgeResizeObserver,
		IntersectionObserver: BridgeIntersectionObserver,
		MutationObserver: BridgeMutationObserver,
	}
}

export type ElementBridge = ReturnType<typeof makeElementBridge>
