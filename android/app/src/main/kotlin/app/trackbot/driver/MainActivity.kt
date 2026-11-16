package app.trackbot.driver

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/** Opens the TrackBot driver portal in a WebView and lets the page hand a delivery to the tracking service. */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private var pendingOrder: String? = null

    private val askLocation = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val order = pendingOrder
        pendingOrder = null
        if (granted && order != null) begin(order) else Toast.makeText(this, R.string.permission_denied, Toast.LENGTH_LONG).show()
    }
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* optional: the service runs either way */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).also { setContentView(it) }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.addJavascriptInterface(NativeBridge(this), "TrackBotNative")
        web.webViewClient = object : WebViewClient() {
            // Only the TrackBot server is shown here. Anything else opens in the normal browser, so no other site can
            // ever reach the bridge above.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (isTrackBot(url)) return false
                startActivity(Intent(Intent.ACTION_VIEW, url))
                return true
            }
        }
        if (savedInstanceState == null) web.loadUrl(BuildConfig.BASE_URL + "/driver/deliveries") else web.restoreState(savedInstanceState)
    }

    private fun isTrackBot(uri: Uri): Boolean = uri.scheme == "https" && uri.host == Uri.parse(BuildConfig.BASE_URL).host

    /** Called from the page (through the bridge). Returns what happened, as a word for the page. */
    fun requestTracking(orderId: String): String {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            runOnUiThread { begin(orderId) }
            return "started"
        }
        runOnUiThread {
            pendingOrder = orderId
            askLocation.launch(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        return "needs_permission"
    }

    private fun begin(orderId: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        TrackingService.start(this, orderId)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Back goes back in the portal first")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }
}
