import "@fontsource/inter/400.css"
import "@fontsource/inter/400-italic.css"
import "./styles.css"

import { Effect } from "effect"
import { Runtime } from "foldkit"
import { loadClerk } from "./app/clerk-loader"
import { galleryComponentOf, startGallery } from "./gallery/boot"
import { Flags, flags, init, managedResources, Message, Model, subscriptions, update, view } from "./main"
import { ResourcesLive } from "./rpc"

const container = document.getElementById("app")!

const startApplication = () =>
	Runtime.run(
		Runtime.makeApplication({
			Model,
			Flags,
			init,
			update,
			view,
			subscriptions,
			managedResources,
			resources: ResourcesLive,
			container,
			routing: {
				onUrlRequest: (request) => Message.ClickedLink({ request }),
				onUrlChange: (url) => Message.ChangedUrl({ url }),
			},
			devTools: { Message },
		}),
		{ flags },
	)

// `/dev/gallery/<name>` boots one UI primitive's gallery program instead of the app (parity scenarios).
const galleryComponent = galleryComponentOf(location.pathname)
if (galleryComponent === undefined) startApplication()
else startGallery(galleryComponent, container)

// Parity's Clerk stub is installed before boot; production downloads the real clerk-js.
const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (galleryComponent === undefined && window.Clerk === undefined && clerkKey)
	Effect.runFork(loadClerk(clerkKey).pipe(Effect.tapError(Effect.logError)))
