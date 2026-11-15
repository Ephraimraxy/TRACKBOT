package app.trackbot.driver

import android.webkit.CookieManager
import app.trackbot.driver.core.HttpPoster
import app.trackbot.driver.core.PostResult
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Sends to the TrackBot server signed in as the delivery person, using the session the WebView already holds (the same
 * cookie the website uses). No password or token is stored by the app. If the session expired the server answers 401.
 */
class UrlConnectionPoster(private val baseUrl: String) : HttpPoster {
    override fun post(path: String, body: String): PostResult {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 20_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                CookieManager.getInstance().getCookie(baseUrl)?.let { setRequestProperty("Cookie", it) }
            }
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = conn.responseCode
            // Read and discard the answer so the connection can be reused.
            (if (status in 200..299) conn.inputStream else conn.errorStream)?.use { it.readBytes() }
            PostResult(status)
        } catch (_: IOException) {
            PostResult(null) // no signal, DNS failure, timeout
        } finally {
            conn?.disconnect()
        }
    }
}
