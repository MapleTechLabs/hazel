/**
 * Element proxies for Mounts that observe geometry (a virtualized list measuring itself). Each
 * proxy stands for one element path; its size and scroll position come from the native host's
 * layout, and ResizeObserver, MutationObserver and `scroll` events fire from host reports. Only
 * Mounts named in `mounts` are acquired: the rest need real DOM and stay inert.
 */
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
	contains(other: EventTarget | null): boolean
	scrollTo(arg: { top?: number } | number, y?: number): void
	scrollIntoView(): void
	focus(): void
	blur(): void
}

type ResizeEntry = {
	readonly target: ProxyElement
	readonly contentRect: Rect
	readonly borderBoxSize: ReadonlyArray<{ inlineSize: number; blockSize: number }>
	readonly contentBoxSize: ReadonlyArray<{ inlineSize: number; blockSize: number }>
}

export type HostScrollCommand = { readonly t: "scroll"; readonly path: string; readonly top: number }

const matchesSelector = (record: ElementRecord, selector: string): boolean => {
	const attr = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(selector)
	if (attr) {
		const [, name, value] = attr
		return value === undefined ? name in record.attrs : record.attrs[name] === value
	}
	if (selector.startsWith("#")) return record.attrs.id === selector.slice(1)
	if (selector.startsWith(".")) return record.classes.includes(selector.slice(1))
	return record.tag === selector.toLowerCase()
}

export const makeElementBridge = (options: {
	readonly mounts: ReadonlySet<string>
	/**
	 * Mounts that need a real DOM (a rich-text editor) get an element from here, typically a
	 * headless DOM's, or `undefined` while it loads. The host draws a native text field in their place.
	 */
	readonly domMounts?: ReadonlyMap<string, () => object | undefined>
	readonly sendScroll: (command: HostScrollCommand) => void
	/** A new element became observed: the host must start reporting its layout. */
	readonly onObserve?: () => void
}) => {
	let records = new Map<string, ElementRecord>()
	const rects = new Map<string, Rect>()
	const scrollTops = new Map<string, number>()
	/** Offsets the runtime set and the host has not drawn yet; older host reports are stale. */
	const pendingScrolls = new Map<string, { top: number; at: number }>()
	const proxies = new Map<string, ProxyElement>()
	const observed = new Set<string>()
	const resizeObservers = new Map<string, Set<(target: ProxyElement) => void>>()
	const mutationObservers = new Set<() => void>()
	let mounted = new Map<string, AnyVNode>()
	const awaitingLayout = new Map<string, AnyVNode>()
	const domElements = new Map<string, object>()

	const proxyFor = (path: string): ProxyElement => {
		const existing = proxies.get(path)
		if (existing) return existing
		observed.add(path)
		options.onObserve?.()
		const ElementClass: new () => EventTarget = globalThis.HTMLElement
		const rect = () => rects.get(path) ?? { x: 0, y: 0, width: 0, height: 0 }
		const record = () => records.get(path)
		const setScrollTop = (top: number) => {
			scrollTops.set(path, top)
			pendingScrolls.set(path, { top, at: performance.now() })
			options.sendScroll({ t: "scroll", path, top })
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
			contains: {
				value: (other: EventTarget | null) =>
					isProxy(other) && (other.__path === path || other.__path.startsWith(`${path}/`)),
			},
			scrollTo: {
				value: (arg: { top?: number } | number, y?: number) =>
					setScrollTop(typeof arg === "number" ? (y ?? 0) : (arg.top ?? 0)),
			},
			scrollIntoView: { value: () => {} },
			focus: { value: () => {} },
			blur: { value: () => {} },
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

	/** After a commit: acquire new Mounts, re-patch kept ones, release gone ones, notify observers. */
	const commit = (next: Map<string, ElementRecord>, mountVNodes: Map<string, AnyVNode>) => {
		records = next
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
			if (makeDomElement === undefined && !rects.has(path)) {
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
			else vnode.data?.hook?.insert?.(vnode)
			nextMounted.set(path, vnode)
		}
		for (const path of [...awaitingLayout.keys()]) if (!mountVNodes.has(path)) awaitingLayout.delete(path)
		for (const [path, vnode] of mounted) {
			if (nextMounted.has(path)) continue
			vnode.data?.hook?.destroy?.(vnode)
			domElements.delete(path)
		}
		mounted = nextMounted
		for (const notify of mutationObservers) notify()
	}

	/** Host layout: a new rect for an observed element. */
	const reportLayout = (path: string, rect: Rect) => {
		const previous = rects.get(path)
		rects.set(path, rect)
		const waiting = awaitingLayout.get(path)
		if (waiting !== undefined) {
			awaitingLayout.delete(path)
			mounted.set(path, waiting)
			waiting.data?.hook?.insert?.(waiting)
			return
		}
		if (previous && previous.width === rect.width && previous.height === rect.height) return
		const proxy = proxies.get(path)
		if (proxy) for (const notify of resizeObservers.get(path) ?? []) notify(proxy)
	}

	const reportScroll = (path: string, top: number) => {
		const pending = pendingScrolls.get(path)
		if (pending !== undefined) {
			// The host may clamp the offset; a report near it, or one well after it, ends the wait.
			const isSettled = Math.abs(top - pending.top) < 2 || performance.now() - pending.at > 500
			if (!isSettled && top !== pending.top) return
			pendingScrolls.delete(path)
		}
		if (scrollTops.get(path) === top) return
		scrollTops.set(path, top)
		proxies.get(path)?.dispatchEvent(new Event("scroll"))
	}

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
		isObserved: (path: string) => observed.has(path),
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
		MutationObserver: BridgeMutationObserver,
	}
}

export type ElementBridge = ReturnType<typeof makeElementBridge>
