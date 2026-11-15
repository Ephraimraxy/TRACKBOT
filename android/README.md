# TrackBot Driver (Android)

A small Android app for delivery people. It opens the normal TrackBot driver portal and adds one thing the browser cannot
do: **a foreground location service that keeps sharing the delivery person's position with the screen off or the app in the
background**, with an on-phone queue for when there is no signal.

```
android/
  core/   plain Kotlin (no Android): fix filtering policy, offline queue, batching, upload rules   <- built and tested
  app/    the Android app: WebView, foreground service, notification, JS bridge                    <- needs the Android SDK
```

## How it fits the existing system
- The page (`components/tracking/LocationSharer.tsx`) looks for `window.TrackBotNative`. In the app it hands the order to
  the app (`start(orderId)`) and shows the app's status; in a normal browser nothing changes (the page shares by itself).
  Never both: the page does not start browser GPS when the app is present.
- The service uploads to the **existing** endpoint, `POST /api/delivery/orders/{id}/location`, as a batch
  `{"points":[{latitude, longitude, accuracy?, capturedAt}]}` using the **P1** rules: each fix keeps the time the GPS
  captured it, late fixes are stored as history, repeats are ignored, only the assigned driver may post, and only while the
  order is out for delivery. **No server change was needed and no authentication was weakened.**
- Sign-in: the app uses the WebView's session cookie (the same one the website uses). It stores no password or token. If the
  session expires the server answers 401: the app keeps the points, the notification and the page ask the person to sign
  in again, and sending resumes by itself.
- It stops by itself when the server says tracking is over (403/409: delivered, cancelled, reassigned).

## Permissions (and why this passes Play review more easily)
| Permission | Why |
|---|---|
| `ACCESS_FINE_LOCATION` | precise GPS, asked only when a delivery is started |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION` | the visible service that keeps location running with the screen off |
| `POST_NOTIFICATIONS` (Android 13+) | the required ongoing notification ("Sharing your live location") |
| `INTERNET`, `ACCESS_NETWORK_STATE` | upload, and send the queue the moment a network returns |

`ACCESS_BACKGROUND_LOCATION` is **not** requested. A location foreground service started while the app is on screen keeps
receiving location in the background, so the heavier "all the time" permission (and its separate Play review) is avoided.
Play still needs the foreground-service declaration form for the `location` type and a short in-app explanation: the
notification text and the page text already say what is shared and that it stops when the delivery ends.

## Build
Needs JDK 17+, Gradle 8.7+ and the Android SDK (platform 35). Google's Maven repository must be reachable.
```
cd android
gradle :core:test                                   # the tracking logic, anywhere
export ANDROID_HOME=~/Android/Sdk
gradle :app:assembleDebug -PtrackbotUrl=https://your-trackbot-domain
```
`trackbotUrl` must be https (cleartext is off) and is the only server the WebView will show; other links open in the
normal browser, so no other site can reach the bridge. For release: sign with your own keystore (never commit it) and build
`:app:assembleRelease` / `bundleRelease`.

## What is verified, and what is not
- **Verified (automatically):** `core` (23 tests: policy, queue incl. restart and damaged file, batching oldest-first, every
  server answer, backoff, stop/sign-out/drop rules); the exact upload body is accepted by the real server code
  (`tests/nativeBridge.test.ts`); the page's behaviour inside the app and outside it, in a real browser with a simulated
  bridge (`tests/browser/native-app.mjs`).
- **NOT verified: the `app` module has never been compiled or run.** The build environment has no Android SDK and cannot reach
  Google's Maven repository, and there is no device. Expect small compile fixes on first build. The service, notification,
  permission flow, fused location, connectivity callback and WebView bridge need real-device testing (below).

## Real-device test plan (do before any release)
1. Install on a phone; sign in to the driver portal in the app; start a delivery. Accept location and notification prompts.
2. Customer/owner page shows the driver moving. Turn the screen off and drive/walk 10 minutes: the dot must keep moving.
3. Switch apps, lock the phone, put the app in the background: still updating. The notification stays visible.
4. Airplane mode for 3 minutes while moving, then back on: the queued points arrive with their original times (replay shows
   no straight-line jump; GPS report lists the gap and "late points").
5. Kill the app from recents: the service should restart and resume the same order (START_STICKY). Reboot: tracking does
   **not** resume until the person opens the app (by design).
6. Mark delivered / cancel the order: the service stops and the notification disappears. Revoke the location permission
   mid-delivery: the service stops cleanly.
7. Let the session expire (or sign out in the portal): notification shows the sign-in message; sign in; queue drains.
8. Battery: 1 hour moving with the screen off; note the drain. Try on at least one phone with aggressive battery saving
   (Tecno/Infinix/Xiaomi are common in Nigeria) and set the app to "Unrestricted" battery use if the OS kills it. Record which models need it.
9. Android 8, 10, 13 and 14: foreground-service type and notification permission behave differently.

## Known limits
- Manufacturers' battery savers can still kill the service; the person may need to set the app to unrestricted battery use.
- After a phone restart tracking waits for the app to be opened.
- GPS fixes indoors or in tunnels are vague (more than ±150 m are skipped) and may leave gaps; the owner's GPS report shows them.
- `loc.time` is the device clock; a badly wrong phone clock gives wrong capture times (the server refuses times more than a minute in the future and older than six hours).
