// Retire the React/Clerk app's Workbox worker during the Foldkit cutover.
// Keep this URL available so existing registrations can update instead of
// retaining their precached HTML when /sw.js falls back to the SPA shell.
self.addEventListener("install", () => self.skipWaiting())

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys()
			await Promise.all(
				keys.filter((key) => key.startsWith("workbox-")).map((key) => caches.delete(key)),
			)
			await self.clients.claim()
			await self.registration.unregister()
			const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
			// One failed navigation must not stop the others.
			await Promise.allSettled(windows.map((client) => client.navigate(client.url)))
		})(),
	)
})
