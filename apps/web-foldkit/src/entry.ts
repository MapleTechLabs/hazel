import "@fontsource/inter/400.css"
import "@fontsource/inter/400-italic.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "./styles.css"

import { Layer } from "effect"
import { Runtime } from "foldkit"
import { setSessionBearerProvider } from "~/lib/session-bearer"
import { initNativeNotifications } from "~/lib/native-notifications"
import { desktopAuthClient } from "./platform/desktop"
import { desktopSessionBearer } from "./platform/desktop-auth"
import { Flags, flags, init, Message, Model, subscriptions, update, view } from "./main"
import { NotificationSinks } from "./app/notification-sinks"
import { viewTransition } from "./app/view-transition"
import { installImageViewerMorph } from "./chat/viewer/morph"
import { installChannelPrefetch } from "./core/db/channel-prefetch"
import { labPathOf } from "./lab/path"
import { ResourcesLive } from "./rpc"
import * as PendingAnnouncement from "./ui/aria/pending-announcement"

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
			// The sinks own audio and native notifications, so they are built here, in the browser only.
			resources: Layer.mergeAll(ResourcesLive, NotificationSinks.layer, PendingAnnouncement.layer),
			container,
			routing: {
				onUrlRequest: (request) => Message.ClickedLink({ request }),
				onUrlChange: (url) => Message.ChangedUrl({ url }),
			},
			// An image viewer opening or closing morphs its image to and from the page.
			viewTransition,
			devTools: { Message },
		}),
		{ flags },
	)

// `/lab/<path>` boots that lab page's own program instead of the app (dev, or `VITE_HAZEL_LAB=on`). The
// flags are inlined at build time, so a production build drops the import and every lab chunk.
const labPath = labPathOf(location.pathname)
if ((import.meta.env.DEV || import.meta.env.VITE_HAZEL_LAB === "on") && labPath !== undefined)
	void import("./lab/boot").then(({ startLab }) => startLab(labPath, container))
else {
	// The desktop app has no API cookie: its requests carry its own session as a bearer.
	if (desktopAuthClient !== null) setSessionBearerProvider(desktopSessionBearer)
	installImageViewerMorph()
	startApplication()
	installChannelPrefetch()
	// Desktop only: native notification permission (a no-op in the browser).
	initNativeNotifications().catch((error: unknown) =>
		console.error("[desktop] native notifications did not start:", error),
	)
}
