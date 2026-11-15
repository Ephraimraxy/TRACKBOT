package app.trackbot.driver.core

/**
 * Which fixes are worth keeping. The server accepts a live point at most every 2 seconds and the customer's map does not
 * need more than every few seconds, so a moving phone reports every [movingIntervalMs]; a phone that has not moved
 * reports only every [idleIntervalMs] (saves battery and data). A fix too vague to be useful is skipped.
 */
class TrackingPolicy(
    val movingIntervalMs: Long = 4_000,
    val idleIntervalMs: Long = 30_000,
    val idleRadiusMetres: Double = 10.0,
    val maxAccuracyMetres: Double = 150.0,
) {
    enum class Decision { KEEP, SKIP_VAGUE, SKIP_TOO_SOON }

    fun decide(lastKept: Fix?, fix: Fix): Decision {
        if ((fix.accuracy ?: 0.0) > maxAccuracyMetres) return Decision.SKIP_VAGUE
        if (lastKept == null) return Decision.KEEP
        val elapsed = fix.capturedAt - lastKept.capturedAt
        if (elapsed < movingIntervalMs) return Decision.SKIP_TOO_SOON
        val moved = Geo.metres(lastKept.latitude, lastKept.longitude, fix.latitude, fix.longitude)
        // Barely moved: wait for the idle interval before reporting again.
        if (moved <= idleRadiusMetres && elapsed < idleIntervalMs) return Decision.SKIP_TOO_SOON
        return Decision.KEEP
    }
}
