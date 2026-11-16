package app.trackbot.driver

import android.content.Context
import org.json.JSONObject

/** What the service remembers between restarts (it can be killed and restarted by the system) and tells the web page. */
object TrackerStore {
    private const val PREFS = "tracker"
    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun orderId(c: Context): String? = prefs(c).getString("orderId", null)
    fun setOrderId(c: Context, id: String?) = prefs(c).edit().apply { if (id == null) remove("orderId") else putString("orderId", id) }.apply()

    fun saveStatus(c: Context, queued: Int, lastSentAt: Long?, lat: Double?, lng: Double?, acc: Double?, capturedAt: Long?, signedOut: Boolean) {
        prefs(c).edit()
            .putInt("queued", queued)
            .putLong("lastSentAt", lastSentAt ?: 0L)
            .putString("lat", lat?.toString()).putString("lng", lng?.toString()).putString("acc", acc?.toString())
            .putLong("capturedAt", capturedAt ?: 0L)
            .putBoolean("signedOut", signedOut)
            .apply()
    }

    /** The status the web page shows, as JSON. */
    fun statusJson(c: Context, running: Boolean): String {
        val p = prefs(c)
        val o = JSONObject()
        o.put("tracking", running)
        o.put("orderId", orderId(c) ?: JSONObject.NULL)
        o.put("queued", p.getInt("queued", 0))
        o.put("signedOut", p.getBoolean("signedOut", false))
        val sent = p.getLong("lastSentAt", 0L)
        o.put("lastSentAt", if (sent == 0L) JSONObject.NULL else sent)
        val lat = p.getString("lat", null)?.toDoubleOrNull()
        val lng = p.getString("lng", null)?.toDoubleOrNull()
        if (lat != null && lng != null) {
            val fix = JSONObject().put("latitude", lat).put("longitude", lng).put("capturedAt", p.getLong("capturedAt", 0L))
            p.getString("acc", null)?.toDoubleOrNull()?.let { fix.put("accuracy", it) }
            o.put("lastFix", fix)
        } else o.put("lastFix", JSONObject.NULL)
        return o.toString()
    }
}
