package app.trackbot.driver

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import app.trackbot.driver.core.Fix
import app.trackbot.driver.core.FilePointQueue
import app.trackbot.driver.core.Outcome
import app.trackbot.driver.core.TrackerEngine
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Foreground location service: keeps sharing the delivery person's position with the screen off or the app in the
 * background, for one order. All tracking decisions live in the tested [TrackerEngine]; this class only connects it to
 * Android (location updates, the notification, connectivity).
 *
 * It stops by itself when the server says tracking is over (the order was delivered or cancelled), or when told to.
 */
class TrackingService : Service() {
    private lateinit var fused: FusedLocationProviderClient
    private val worker: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private var engine: TrackerEngine? = null
    private var signedOut = false
    private var callback: LocationCallback? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        fused = LocationServices.getFusedLocationProviderClient(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopTracking()
            return START_NOT_STICKY
        }
        // After the system restarts a killed service the intent is null: carry on with the order we remembered.
        val orderId = intent?.getStringExtra(EXTRA_ORDER_ID) ?: TrackerStore.orderId(this)
        if (orderId == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        TrackerStore.setOrderId(this, orderId)
        startInForeground(getString(R.string.notification_text))
        running = true

        if (engine == null || engineOrder != orderId) {
            engineOrder = orderId
            engine = TrackerEngine(orderId, FilePointQueue(File(filesDir, "queue-$orderId.txt")), UrlConnectionPoster(BuildConfig.BASE_URL))
            startLocationUpdates()
            watchConnectivity()
            scheduleFlush(0)
        }
        return START_STICKY
    }

    private var engineOrder: String? = null

    private fun startInForeground(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        else startForeground(NOTIFICATION_ID, n)
    }

    @Suppress("MissingPermission") // checked by MainActivity before the service is started
    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 4_000)
            .setMinUpdateIntervalMillis(2_000)
            .setWaitForAccurateLocation(false)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                for (loc in result.locations) {
                    // loc.time is when the GPS produced the fix, not when we got it: kept as the capture time.
                    val fix = Fix(loc.latitude, loc.longitude, if (loc.hasAccuracy()) loc.accuracy.toDouble() else null, loc.time)
                    worker.execute { engine?.onFix(fix); flushNow() }
                }
            }
        }
        callback = cb
        try {
            fused.requestLocationUpdates(request, cb, Looper.getMainLooper())
        } catch (_: SecurityException) {
            stopTracking() // permission was withdrawn
        }
    }

    /** The moment the phone gets a network, send what was kept. */
    private fun watchConnectivity() {
        val cm = getSystemService(ConnectivityManager::class.java)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { worker.execute { flushNow() } }
        }
        networkCallback = cb
        try { cm.registerDefaultNetworkCallback(cb) } catch (_: Exception) { /* the periodic retry still covers it */ }
    }

    private fun scheduleFlush(delayMs: Long) {
        if (!worker.isShutdown) worker.schedule({ flushNow() }, delayMs, TimeUnit.MILLISECONDS)
    }

    /** Runs on the worker thread only. */
    private fun flushNow() {
        val e = engine ?: return
        val result = e.flush()
        when (result.outcome) {
            Outcome.STOP -> { stopTracking(); return }
            Outcome.SIGNED_OUT -> if (!signedOut) { signedOut = true; startInForeground(getString(R.string.notification_signed_out)) }
            Outcome.SENT -> if (signedOut) { signedOut = false; startInForeground(getString(R.string.notification_text)) }
            else -> Unit
        }
        val last = e.lastKept
        TrackerStore.saveStatus(this, e.queued(), e.lastSentAt, last?.latitude, last?.longitude, last?.accuracy, last?.capturedAt, signedOut)
        // Retry later when something is still waiting (backing off), and keep a slow heartbeat otherwise.
        scheduleFlush(if (e.queued() > 0) maxOf(e.retryDelayMs(), 5_000) else 10_000)
    }

    private fun stopTracking() {
        running = false
        callback?.let { fused.removeLocationUpdates(it) }
        callback = null
        networkCallback?.let { runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } }
        networkCallback = null
        TrackerStore.setOrderId(this, null)
        engine = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        callback?.let { fused.removeLocationUpdates(it) }
        worker.shutdownNow()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_ORDER_ID = "orderId"
        const val ACTION_STOP = "app.trackbot.driver.STOP"
        private const val CHANNEL = "tracking"
        private const val NOTIFICATION_ID = 1001

        @Volatile var running = false
            private set

        fun start(context: Context, orderId: String) {
            val i = Intent(context, TrackingService::class.java).putExtra(EXTRA_ORDER_ID, orderId)
            androidx.core.content.ContextCompat.startForegroundService(context, i)
        }

        fun stop(context: Context) {
            context.startService(Intent(context, TrackingService::class.java).setAction(ACTION_STOP))
        }
    }
}
