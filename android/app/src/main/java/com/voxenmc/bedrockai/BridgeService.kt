package com.voxenmc.bedrockai

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

// The whole point of the app is to keep serving while Minecraft is in front,
// and Android only lets a foreground service do that. Without this the bridge
// is frozen the moment the player switches to the game.
class BridgeService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTE_ID, buildNotification())
        NodeEngine.start(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            // Node has no clean shutdown from here; the process goes with it
            android.os.Process.killProcess(android.os.Process.myPid())
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    private fun buildNotification(): android.app.Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "AI bridge", NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "Keeps the AI reachable while you play" }
            )
        }

        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, BridgeService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("Bedrock AI is running")
            .setContentText("/connect localhost:${NodeEngine.PORT}")
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .setOngoing(true)
            .build()
    }

    companion object {
        const val CHANNEL = "bridge"
        const val NOTE_ID = 1
        const val ACTION_STOP = "com.voxenmc.bedrockai.STOP"
    }
}
