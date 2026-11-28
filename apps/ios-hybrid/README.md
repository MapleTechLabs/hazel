# Hazel for iOS

The native app (`Hazel/`): the shared `hazel` screens (`apps/shared-screens`) drawn by HazelUI's
SwiftUI renderers (`HazelUI/`), their script (`script/`, bundled to `build/script/hazel.js`) running in
JavaScriptCore. See `docs/ios-native.md`.

- **Screens** are the shared ones, one registry (`shared-screens/src/app/screens.ts`), in the phone
  shell (`shared-screens/src/phone/PhoneShell.ts`): system tabs, a navigation stack per tab, deep links
  (`hazelchat:///<org>/chat/<channel>`).
- **A route with no native screen yet** is the web app in a web view, pushed like any screen
  (`Hazel/FallbackPage.swift`, the page's side in `web/`). It signs in through the same keychain record
  (`Shared/HostBridge.swift`), and a link in it opens as a screen of its own.
- **Icons** are plain PNGs in HazelUI's resources (`scripts/export-icons.ts`), not an asset catalog.

```sh
OFFLINE=1 bash scripts/build-hazel.sh        # the simulator app against the offline fixture
bun scripts/fixture-backend.ts               # the fixture API (port 4320); launch with
                                             #   -HazelApiUrl http://127.0.0.1:4320 -HazelToken fixture
bun run test:hazelui S1                      # HazelUI's snapshot lanes (S0 to S5)
BUILD=<n> bash scripts/release.sh            # TestFlight (HazelChat, `hazel.app`); BUILD above the latest
```

`EffectUiSpike/` is the Effect UI gallery app the renderers were built against (`build-effect-ui.sh`).
Debug a fallback page with Safari's Develop menu (its web view is inspectable); its console is in the
app's log (subsystem `sh.hazel.app`, category `fallback`).
