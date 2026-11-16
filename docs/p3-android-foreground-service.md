# P3: native Android foreground location service

Full details, build steps, permission rationale and the real-device test plan: `android/README.md`.

Summary
- New `android/` project: `core` (plain Kotlin: policy, offline queue, batching, upload rules; 23 tests) and `app` (WebView
  that opens the driver portal, foreground location service, notification, JavaScript bridge).
- The page (`components/tracking/LocationSharer.tsx`, `lib/native/bridge.ts`) hands sharing to the app when
  `window.TrackBotNative` exists and shows the app's status (last fix, points waiting, signed-out notice, ended by server).
  In a normal browser nothing changes.
- The app uploads to the existing endpoint using the P1 batch format and capture times. No server change, no weakened
  authentication: same session cookie, same assigned-driver and out-for-delivery checks.
- No `ACCESS_BACKGROUND_LOCATION`: a foreground service started from the visible app keeps location running.

Tests added: `android/core` Kotlin tests, `tests/nativeBridge.test.ts` (bridge validation and the exact batch format accepted by
the real server code), `tests/browser/native-app.mjs` (page inside and outside the app, in a real browser).

Not verified: the `app` module has not been compiled or run (no Android SDK, no access to Google's Maven repository, no
device). See "What is verified, and what is not" in `android/README.md`.
