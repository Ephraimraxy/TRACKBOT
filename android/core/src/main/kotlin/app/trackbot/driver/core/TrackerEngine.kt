package app.trackbot.driver.core

/**
 * The tracking logic for ONE order, with no Android in it: keep the worthwhile fixes, send them in batches oldest first,
 * and decide what each answer means. The Android service feeds it fixes and calls [flush] when there is signal.
 */
class TrackerEngine(
    private val orderId: String,
    private val queue: PointQueue,
    private val poster: HttpPoster,
    private val policy: TrackingPolicy = TrackingPolicy(),
) {
    var lastKept: Fix? = null
        private set
    var lastSentAt: Long? = null
        private set
    var failures: Int = 0
        private set
    /** Set once the server said tracking is over; nothing more is kept or sent. */
    var stopped: Boolean = false
        private set

    fun path() = "/api/delivery/orders/$orderId/location"
    fun queued() = queue.size()

    /** Offer a fix. Returns what the policy decided; kept fixes are queued (and so survive a lost connection). */
    fun onFix(fix: Fix): TrackingPolicy.Decision {
        if (stopped) return TrackingPolicy.Decision.SKIP_TOO_SOON
        val decision = policy.decide(lastKept, fix)
        if (decision == TrackingPolicy.Decision.KEEP) {
            queue.add(fix)
            lastKept = fix
        }
        return decision
    }

    /** Send what is queued, oldest first, in batches. Stops at the first batch that cannot be delivered. */
    fun flush(now: Long = System.currentTimeMillis()): FlushResult {
        if (stopped) return FlushResult(0, 0, Outcome.STOP)
        var sent = 0
        while (true) {
            val batch = queue.all().take(BATCH_SIZE)
            if (batch.isEmpty()) {
                failures = 0
                return FlushResult(sent, 0, if (sent > 0) Outcome.SENT else null)
            }
            when (val outcome = outcomeOf(poster.post(path(), batchBody(batch)).status)) {
                Outcome.SENT -> {
                    queue.drop(batch.size)
                    sent += batch.size
                    lastSentAt = now
                    failures = 0
                }
                Outcome.DROP -> queue.drop(batch.size)
                Outcome.STOP -> {
                    queue.clear()
                    stopped = true
                    return FlushResult(sent, 0, outcome)
                }
                Outcome.RETRY, Outcome.SIGNED_OUT -> {
                    failures++
                    return FlushResult(sent, queue.size(), outcome)
                }
            }
        }
    }

    /** How long to wait before the next flush attempt, given the failures so far. */
    fun retryDelayMs(): Long = backoffMs(failures)
}
