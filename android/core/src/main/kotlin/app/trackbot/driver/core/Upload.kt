package app.trackbot.driver.core

/** What the server said, or `null` status when there was no answer at all (no signal, timeout). */
data class PostResult(val status: Int?)

fun interface HttpPoster {
    /** POST [body] (JSON) to [path] on the TrackBot server, signed in as the delivery person. */
    fun post(path: String, body: String): PostResult
}

/** What to do after one upload attempt. */
enum class Outcome {
    /** Accepted: remove these points from the queue. */
    SENT,
    /** No signal, server busy or failing (429, 5xx): keep the points and try again later. */
    RETRY,
    /** The delivery person is signed out (401): keep the points, ask them to sign in, try again afterwards. */
    SIGNED_OUT,
    /** The server says tracking is over for this order (403, 409): stop, and empty the queue. */
    STOP,
    /** The server rejected the request itself (400): drop this batch so one bad batch never blocks the rest. */
    DROP,
}

fun outcomeOf(status: Int?): Outcome = when (status) {
    null -> Outcome.RETRY
    in 200..299 -> Outcome.SENT
    401 -> Outcome.SIGNED_OUT
    403, 409 -> Outcome.STOP
    400 -> Outcome.DROP
    else -> Outcome.RETRY // 429, 5xx and anything unexpected
}

/** The body for `POST /api/delivery/orders/{id}/location`: a batch of points, each with its original capture time. */
fun batchBody(points: List<Fix>): String = points.joinToString(prefix = "{\"points\":[", postfix = "]}", separator = ",") {
    val acc = it.accuracy?.takeIf { a -> a.isFinite() && a >= 0 }?.let { a -> ",\"accuracy\":$a" } ?: ""
    "{\"latitude\":${it.latitude},\"longitude\":${it.longitude}$acc,\"capturedAt\":${it.capturedAt}}"
}

/** The most points the server accepts in one request is 200; stay well under it. */
const val BATCH_SIZE = 100

data class FlushResult(val sent: Int, val remaining: Int, val outcome: Outcome?)

/** Wait before the next attempt after `attempt` failures in a row: 5 s, 10 s, 20 s ... never more than 2 minutes. */
fun backoffMs(attempt: Int, baseMs: Long = 5_000, maxMs: Long = 120_000): Long {
    if (attempt <= 0) return 0
    var d = baseMs
    repeat(attempt - 1) { d = Math.min(maxMs, d * 2) }
    return Math.min(maxMs, d)
}
