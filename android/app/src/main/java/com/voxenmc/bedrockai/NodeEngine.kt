package com.voxenmc.bedrockai

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File

// Owns the Node runtime. node_start never returns, so it gets its own thread
// and the rest of the app only ever asks whether it is up.
object NodeEngine {
    const val PORT = 8080
    private const val TAG = "BedrockAI"

    @Volatile private var started = false

    init {
        System.loadLibrary("node")
        System.loadLibrary("bedrockai")
    }

    @JvmStatic private external fun nativeStart(args: Array<String>): Int

    val isRunning: Boolean get() = started

    fun start(context: Context) {
        if (started) return
        started = true

        val home = File(context.filesDir, "bridge")
        copyAssets(context, "bridge", home)
        writeConfig(context, home)

        // Node resolves everything from the working directory, and there is no
        // chdir to it from here, so the entry point is given as a full path.
        val entry = File(home, "src/server.js").absolutePath
        Thread({
            try {
                nativeStart(arrayOf("node", entry))
            } catch (e: Throwable) {
                Log.e(TAG, "node stopped", e)
            }
            started = false
        }, "node").start()
    }

    // Assets cannot be read as files, so the bridge is unpacked once per
    // version into the app's own storage.
    private fun copyAssets(context: Context, path: String, into: File) {
        val names = context.assets.list(path) ?: return
        if (names.isEmpty()) {
            into.parentFile?.mkdirs()
            context.assets.open(path).use { input ->
                into.outputStream().use { input.copyTo(it) }
            }
            return
        }
        into.mkdirs()
        for (name in names) copyAssets(context, "$path/$name", File(into, name))
    }

    private fun writeConfig(context: Context, home: File) {
        val file = File(home, "config.json")
        val existing = if (file.exists()) JSONObject(file.readText()) else JSONObject()
        val prefs = context.getSharedPreferences("bedrockai", Context.MODE_PRIVATE)

        existing.put("provider", prefs.getString("provider", "groq"))
        existing.put("apiKey", prefs.getString("apiKey", "") ?: "")
        existing.put("port", PORT)
        // the phone has no com.mojang it can read, so the world list stays empty
        // and the app does its own add-on install through an intent instead
        existing.put("useGameContext", true)
        existing.put("allowActions", true)
        existing.put("allowRawCommands", true)
        file.writeText(existing.toString(2))
    }

    fun hasKey(context: Context): Boolean {
        val prefs = context.getSharedPreferences("bedrockai", Context.MODE_PRIVATE)
        return !prefs.getString("apiKey", "").isNullOrBlank()
    }

    fun saveKey(context: Context, key: String) {
        context.getSharedPreferences("bedrockai", Context.MODE_PRIVATE)
            .edit().putString("apiKey", key.trim()).apply()
    }
}
