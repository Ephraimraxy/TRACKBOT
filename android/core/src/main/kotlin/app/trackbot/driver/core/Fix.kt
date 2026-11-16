package app.trackbot.driver.core

/** One GPS fix. `capturedAt` is when the phone's GPS produced it, in milliseconds since 1970 (never "when we sent it"). */
data class Fix(val latitude: Double, val longitude: Double, val accuracy: Double?, val capturedAt: Long)

object Geo {
    /** Distance in metres between two points on the Earth (haversine). */
    fun metres(aLat: Double, aLng: Double, bLat: Double, bLng: Double): Double {
        val r = 6_371_000.0
        val dLat = Math.toRadians(bLat - aLat)
        val dLng = Math.toRadians(bLng - aLng)
        val h = Math.sin(dLat / 2).let { it * it } +
            Math.cos(Math.toRadians(aLat)) * Math.cos(Math.toRadians(bLat)) * Math.sin(dLng / 2).let { it * it }
        return 2 * r * Math.asin(Math.min(1.0, Math.sqrt(h)))
    }
}
