package app.trackbot.driver.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val NOW = 10_000_000_000L
private fun fix(secondsAgo: Int, lat: Double = 8.84, lng: Double = 7.87, acc: Double? = 10.0) = Fix(lat, lng, acc, NOW - secondsAgo * 1000L)

class TrackingPolicyTest {
    private val policy = TrackingPolicy()

    @Test fun keepsTheFirstFix() = assertEquals(TrackingPolicy.Decision.KEEP, policy.decide(null, fix(0)))

    @Test fun skipsVagueFixes() = assertEquals(TrackingPolicy.Decision.SKIP_VAGUE, policy.decide(null, fix(0, acc = 400.0)))

    @Test fun skipsFixesCloserThanTheMovingInterval() =
        assertEquals(TrackingPolicy.Decision.SKIP_TOO_SOON, policy.decide(fix(10), fix(8, lng = 7.871)))

    @Test fun keepsAMovingPhoneEveryFewSeconds() =
        assertEquals(TrackingPolicy.Decision.KEEP, policy.decide(fix(10), fix(5, lng = 7.871))) // ~110 m in 5 s

    @Test fun reportsAStationaryPhoneOnlyEveryHalfMinute() {
        val still = fix(20)
        assertEquals(TrackingPolicy.Decision.SKIP_TOO_SOON, policy.decide(still, fix(10, lat = 8.84001))) // 10 s, ~1 m
        assertEquals(TrackingPolicy.Decision.KEEP, policy.decide(still, fix(-10, lat = 8.84001))) // 30 s later
    }

    @Test fun measuresDistanceLikeTheServer() {
        val d = Geo.metres(8.84, 7.87, 8.84, 7.88) // 0.01 degrees of longitude at this latitude
        assertTrue(d in 1090.0..1120.0, "was $d")
    }
}

class PointQueueTest {
    private fun file() = File.createTempFile("queue", ".txt").also { it.delete() }

    @Test fun keepsOriginalCaptureTimesOldestFirst() {
        val q = MemoryPointQueue { NOW }
        q.add(fix(10)); q.add(fix(50)); q.add(fix(30))
        assertEquals(listOf(NOW - 50_000, NOW - 30_000, NOW - 10_000), q.all().map { it.capturedAt })
    }

    @Test fun dropsFixesOlderThanTheServerAccepts() {
        val q = MemoryPointQueue { NOW }
        q.add(Fix(8.84, 7.87, 5.0, NOW - QUEUE_MAX_AGE_MS - 1000))
        assertEquals(0, q.size())
    }

    @Test fun dropsTheOldestWhenFull() {
        val q = MemoryPointQueue { NOW }
        repeat(QUEUE_MAX_POINTS + 20) { q.add(fix(QUEUE_MAX_POINTS + 20 - it)) }
        assertEquals(QUEUE_MAX_POINTS, q.size())
        assertEquals(NOW - QUEUE_MAX_POINTS * 1000L, q.all().first().capturedAt)
    }

    @Test fun theFileQueueSurvivesARestart() {
        val f = file()
        FilePointQueue(f) { NOW }.add(fix(5, acc = null))
        val again = FilePointQueue(f) { NOW }.all()
        assertEquals(1, again.size)
        assertNull(again[0].accuracy)
        assertEquals(NOW - 5000, again[0].capturedAt)
        f.delete()
    }

    @Test fun aDamagedFileIsSkippedNotFatal() {
        val f = file()
        f.writeText("not,a,fix\n8.84,7.87,10.0,${NOW - 1000}\ngarbage\n99999,7.87,10,${NOW - 2000}\n")
        val q = FilePointQueue(f) { NOW }
        assertEquals(1, q.size())
        f.delete()
    }

    @Test fun dropRemovesTheOldestAndClearEmpties() {
        val f = file()
        val q = FilePointQueue(f) { NOW }
        q.add(fix(30)); q.add(fix(20)); q.add(fix(10))
        q.drop(2)
        assertEquals(listOf(NOW - 10_000), q.all().map { it.capturedAt })
        q.clear()
        assertFalse(f.exists())
    }
}

class UploadRulesTest {
    @Test fun mapsServerAnswersToActions() {
        assertEquals(Outcome.SENT, outcomeOf(201))
        assertEquals(Outcome.RETRY, outcomeOf(null))
        assertEquals(Outcome.RETRY, outcomeOf(429))
        assertEquals(Outcome.RETRY, outcomeOf(503))
        assertEquals(Outcome.SIGNED_OUT, outcomeOf(401))
        assertEquals(Outcome.STOP, outcomeOf(403))
        assertEquals(Outcome.STOP, outcomeOf(409))
        assertEquals(Outcome.DROP, outcomeOf(400))
    }

    @Test fun buildsTheBatchTheServerExpects() {
        val body = batchBody(listOf(Fix(8.84, 7.87, 9.5, 1700000000000), Fix(8.85, 7.88, null, 1700000004000)))
        assertEquals("""{"points":[{"latitude":8.84,"longitude":7.87,"accuracy":9.5,"capturedAt":1700000000000},{"latitude":8.85,"longitude":7.88,"capturedAt":1700000004000}]}""", body)
    }

    @Test fun backsOffButNeverPastTwoMinutes() {
        assertEquals(0, backoffMs(0))
        assertEquals(5_000, backoffMs(1))
        assertEquals(10_000, backoffMs(2))
        assertEquals(20_000, backoffMs(3))
        assertEquals(120_000, backoffMs(20))
    }
}

class TrackerEngineTest {
    private class FakePoster(var answers: MutableList<Int?>) : HttpPoster {
        val bodies = mutableListOf<String>()
        val paths = mutableListOf<String>()
        override fun post(path: String, body: String): PostResult {
            paths += path; bodies += body
            return PostResult(if (answers.isEmpty()) 201 else answers.removeAt(0))
        }
    }

    private fun engine(poster: HttpPoster, queue: PointQueue = MemoryPointQueue { NOW }) = TrackerEngine("order1", queue, poster)

    @Test fun sendsKeptFixesToTheOrdersLocationEndpoint() {
        val poster = FakePoster(mutableListOf(201))
        val e = engine(poster)
        e.onFix(fix(20)); e.onFix(fix(10, lng = 7.871))
        val r = e.flush(NOW)
        assertEquals(2, r.sent)
        assertEquals(0, r.remaining)
        assertEquals(listOf("/api/delivery/orders/order1/location"), poster.paths)
        assertEquals(NOW, e.lastSentAt)
    }

    @Test fun keepsFixesWhileOfflineAndSendsThemOldestFirstWithOriginalTimes() {
        val poster = FakePoster(mutableListOf(null, null, 201))
        val e = engine(poster)
        e.onFix(fix(60)); e.onFix(fix(40, lng = 7.871)); e.onFix(fix(20, lng = 7.872))
        assertEquals(Outcome.RETRY, e.flush(NOW).outcome)
        assertEquals(3, e.queued()) // nothing lost
        assertEquals(Outcome.RETRY, e.flush(NOW).outcome)
        assertEquals(10_000, e.retryDelayMs())
        val r = e.flush(NOW)
        assertEquals(3, r.sent)
        assertEquals(0, e.failures)
        val sent = poster.bodies.last()
        assertTrue(sent.indexOf("${NOW - 60_000}") < sent.indexOf("${NOW - 40_000}") && sent.indexOf("${NOW - 40_000}") < sent.indexOf("${NOW - 20_000}"))
    }

    @Test fun sendsInBatchesOfAHundred() {
        val poster = FakePoster(mutableListOf())
        val e = engine(poster)
        val q = MemoryPointQueue { NOW }
        val big = TrackerEngine("o", q, poster)
        repeat(250) { q.add(fix(300 - it)) }
        assertEquals(250, big.flush(NOW).sent)
        assertEquals(3, poster.bodies.size)
        assertEquals(0, e.queued())
    }

    @Test fun stopsAndEmptiesTheQueueWhenTrackingIsOver() {
        for (status in listOf(403, 409)) {
            val e = engine(FakePoster(mutableListOf(status)))
            e.onFix(fix(5))
            assertEquals(Outcome.STOP, e.flush(NOW).outcome)
            assertTrue(e.stopped)
            assertEquals(0, e.queued())
            e.onFix(fix(0, lng = 7.9)) // nothing more is kept
            assertEquals(0, e.queued())
        }
    }

    @Test fun keepsPointsWhenSignedOut() {
        val e = engine(FakePoster(mutableListOf(401)))
        e.onFix(fix(5))
        val r = e.flush(NOW)
        assertEquals(Outcome.SIGNED_OUT, r.outcome)
        assertEquals(1, r.remaining)
        assertFalse(e.stopped)
    }

    @Test fun dropsABatchTheServerRejectsSoItNeverBlocksTheRest() {
        val e = engine(FakePoster(mutableListOf(400)))
        e.onFix(fix(5))
        e.flush(NOW)
        assertEquals(0, e.queued())
    }

    @Test fun doesNotQueueVagueOrTooFrequentFixes() {
        val e = engine(FakePoster(mutableListOf()))
        e.onFix(fix(20, acc = 500.0))
        e.onFix(fix(10)); e.onFix(fix(9, lng = 7.8701))
        assertEquals(1, e.queued())
    }

    @Test fun anEmptyQueueSendsNothing() {
        val poster = FakePoster(mutableListOf())
        val r = engine(poster).flush(NOW)
        assertEquals(0, poster.bodies.size)
        assertNull(r.outcome)
    }
}
