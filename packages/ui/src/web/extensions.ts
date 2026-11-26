/**
 * The web's extension registry (`docs/hazel-ui.md`, "Platform extensions"): what the web host draws in
 * an `hz:ext` placeholder whose extension it implements.
 */
import type { Plain } from "./primitives/define.ts"
import type { Hazel } from "../vocabulary/index.ts"

export interface WebExtensionInstance<P> {
	readonly update?: (props: P) => void
	readonly dispose?: () => void
}

/** Draws an extension into `container`; `send` fires one of its declared events. */
export type WebExtension<D extends Hazel.AnyExtension> = (
	container: HTMLElement,
	props: Hazel.PropsOf<D>,
	send: <K extends keyof Hazel.ExtensionEvents<D> & string>(
		event: K,
		payload: Hazel.ExtensionEvents<D>[K],
	) => boolean,
) => WebExtensionInstance<Hazel.PropsOf<D>> | void

const registry = new Map<string, WebExtension<any>>()
const live = new WeakMap<Element, { readonly json: string; readonly instance: WebExtensionInstance<any> }>()

export const registerWebExtension = <D extends Hazel.AnyExtension>(definition: D, draw: WebExtension<D>) => {
	registry.set(definition.name, draw)
}

/** The declared extensions that list `web` but the web has not registered (the startup check). */
export const missingWebExtensions = (declared: ReadonlyArray<Hazel.AnyExtension>) =>
	declared.filter((definition) => definition.platforms.includes("web") && !registry.has(definition.name))

/** Draws or updates `name` in `surface`. False when the web does not implement it (fallback shows). */
export const mountExtension = (
	surface: HTMLElement,
	name: string,
	props: Plain,
	send: (event: string, payload: Plain) => boolean,
): boolean => {
	const draw = registry.get(name)
	if (draw === undefined) return false
	const json = JSON.stringify(props ?? null)
	const current = live.get(surface)
	if (current !== undefined) {
		if (current.json !== json) {
			current.instance.update?.(props)
			live.set(surface, { json, instance: current.instance })
		}
		return true
	}
	live.set(surface, { json, instance: draw(surface, props, send as never) ?? {} })
	return true
}

export const dispose = (surface: Element) => {
	live.get(surface)?.instance.dispose?.()
	live.delete(surface)
}
