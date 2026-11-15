package app.trackbot.driver.core

import java.io.File

/**
 * Fixes waiting to be sent, each with its ORIGINAL capture time. The server stores a late fix at that time, as history,
 * and ignores repeats, so keeping and re-sending is always safe.
 */
interface PointQueue {
    fun add(fix: Fix)
    /** Everything kept, oldest first. */
    fun all(): List<Fix>
    fun size(): Int = all().size
    /** Remove the first [n] (oldest) fixes after they were sent. */
    fun drop(n: Int)
    fun clear()
}

const val QUEUE_MAX_AGE_MS = 6L * 3600_000
const val QUEUE_MAX_POINTS = 500

private fun List<Fix>.freshAndSorted(now: Long): List<Fix> = filter { now - it.capturedAt <= QUEUE_MAX_AGE_MS }.sortedBy { it.capturedAt }

class MemoryPointQueue(private val now: () -> Long = System::currentTimeMillis) : PointQueue {
    private var items: List<Fix> = emptyList()
    override fun add(fix: Fix) { items = (items + fix).freshAndSorted(now()).takeLast(QUEUE_MAX_POINTS) }
    override fun all(): List<Fix> = items.freshAndSorted(now())
    override fun drop(n: Int) { items = all().drop(n) }
    override fun clear() { items = emptyList() }
}

/**
 * The same queue kept in a file, so it survives the app being killed or the phone restarting. One line per fix:
 * `latitude,longitude,accuracy,capturedAt` (accuracy empty when unknown). Written to a temporary file and renamed, so a
 * crash while writing never leaves a half-written queue. A damaged line is skipped, not fatal.
 */
class FilePointQueue(private val file: File, private val now: () -> Long = System::currentTimeMillis) : PointQueue {
    private fun read(): List<Fix> {
        if (!file.exists()) return emptyList()
        return try {
            file.readLines().mapNotNull(::parse)
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun write(items: List<Fix>) {
        try {
            if (items.isEmpty()) {
                file.delete()
                return
            }
            file.parentFile?.mkdirs()
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(items.joinToString("\n") { format(it) } + "\n")
            if (!tmp.renameTo(file)) {
                file.delete()
                tmp.renameTo(file)
            }
        } catch (_: Exception) {
            // Storage full or unavailable: the next add tries again. Losing a point is better than crashing the service.
        }
    }

    override fun add(fix: Fix) = write((read() + fix).freshAndSorted(now()).takeLast(QUEUE_MAX_POINTS))
    override fun all(): List<Fix> = read().freshAndSorted(now())
    override fun drop(n: Int) = write(all().drop(n))
    override fun clear() = write(emptyList())

    companion object {
        fun format(f: Fix) = "${f.latitude},${f.longitude},${f.accuracy ?: ""},${f.capturedAt}"
        fun parse(line: String): Fix? {
            val p = line.trim().split(",")
            if (p.size != 4) return null
            val lat = p[0].toDoubleOrNull() ?: return null
            val lng = p[1].toDoubleOrNull() ?: return null
            val at = p[3].toLongOrNull() ?: return null
            if (!lat.isFinite() || !lng.isFinite() || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
            return Fix(lat, lng, p[2].toDoubleOrNull(), at)
        }
    }
}
