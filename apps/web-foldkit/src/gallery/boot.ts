import type { GalleryEntry } from "./define"

/** One module per primitive in `./entries/<name>.ts`, mirroring `apps/web/src/dev-gallery/entries/<name>.tsx`. */
const entries = new Map(
	Object.entries(import.meta.glob<{ gallery: GalleryEntry }>("./entries/*.ts", { eager: true })).map(
		([path, module]) => [path.replace(/^.*\/(.+)\.ts$/, "$1"), module.gallery],
	),
)

export const galleryComponentOf = (pathname: string): string | undefined =>
	pathname.match(/^\/dev\/gallery\/([^/]+)\/?$/)?.[1]

export const startGallery = (component: string, container: HTMLElement) => {
	const entry = entries.get(component)
	if (entry) return entry.start(container)
	container.textContent = `Unknown gallery component: ${component}. Known: ${[...entries.keys()].join(", ")}`
}
