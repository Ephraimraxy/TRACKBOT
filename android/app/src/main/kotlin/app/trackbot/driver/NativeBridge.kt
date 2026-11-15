package app.trackbot.driver

import android.webkit.JavascriptInterface

/**
 * What the TrackBot web page can ask of the app (as `window.TrackBotNative`). Only pages from the TrackBot server are
 * ever loaded in this WebView (see MainActivity), so no other site can reach it. The page is not trusted with anything
 * but "track this order": the position, the server address and the sign-in all stay inside the app.
 */
class NativeBridge(private val activity: MainActivity) {
    @JavascriptInterface fun isAvailable(): Boolean = true

    @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME

    /** Start sharing for an order. Returns "started", "needs_permission" (the person is being asked) or "invalid". */
    @JavascriptInterface fun start(orderId: String): String {
        if (!ORDER_ID.matches(orderId)) return "invalid"
        return activity.requestTracking(orderId)
    }

    @JavascriptInterface fun stop() = activity.runOnUiThread { TrackingService.stop(activity) }

    /** `{tracking, orderId, queued, signedOut, lastSentAt, lastFix}` as JSON. */
    @JavascriptInterface fun status(): String = TrackerStore.statusJson(activity, TrackingService.running)

    companion object {
        // Order ids are cuid strings: letters and digits only.
        private val ORDER_ID = Regex("^[A-Za-z0-9]{10,40}$")
    }
}
