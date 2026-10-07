import { createFileRoute, Link } from "@tanstack/react-router"
import { type ComponentType, lazy, Suspense } from "react"
import { GalleryFrame } from "~/dev-gallery/frame"

/**
 * Every state of one UI primitive, for parity scenarios. One file per primitive in
 * `src/dev-gallery/entries/<name>.tsx`, mirrored by `apps/web-foldkit/src/gallery/entries/<name>.ts`.
 */
interface GalleryModule {
	readonly title: string
	readonly Gallery: ComponentType
}

// Lazy, so entries (and the React Aria modules they pull in) never load during normal app boot.
const entries = new Map(
	Object.entries(import.meta.glob<GalleryModule>("/src/dev-gallery/entries/*.tsx")).map(([path, load]) => [
		path.replace(/^.*\/(.+)\.tsx$/, "$1"),
		lazy(() =>
			load().then((module) => ({
				default: () => (
					<GalleryFrame title={module.title}>
						<module.Gallery />
					</GalleryFrame>
				),
			})),
		),
	]),
)

export const Route = createFileRoute("/dev/gallery/$component")({
	component: RouteComponent,
})

function RouteComponent() {
	const { component } = Route.useParams()
	const entry = entries.get(component)
	if (!entry)
		return (
			<GalleryFrame title={`Unknown gallery component: ${component}`}>
				{[...entries.keys()].map((name) => (
					<Link key={name} to="/dev/gallery/$component" params={{ component: name }}>
						{name}
					</Link>
				))}
			</GalleryFrame>
		)
	const Entry = entry
	return (
		<Suspense fallback={null}>
			<Entry />
		</Suspense>
	)
}
