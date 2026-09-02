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
        val id = provider(context)
        existing.put("provider", id)
        existing.put("apiKey", keyFor(context, id))
        // let the bridge choose the model for whichever service this is
        existing.remove("model")
        existing.put("port", PORT)
        // the phone has no com.mojang it can read, so the world list stays empty
        // and the app does its own add-on install through an intent instead
        existing.put("useGameContext", true)
        existing.put("allowActions", true)
        existing.put("allowRawCommands", true)
        file.writeText(existing.toString(2))
    }

    // Every service issues its own key, so they are stored per service: moving
    // between them does not wipe the one already entered.
    private fun prefs(context: Context) =
        context.getSharedPreferences("bedrockai", Context.MODE_PRIVATE)

    fun provider(context: Context): String =
        prefs(context).getString("provider", "groq") ?: "groq"

    fun setProvider(context: Context, id: String) =
        prefs(context).edit().putString("provider", id).apply()

    fun keyFor(context: Context, id: String): String =
        prefs(context).getString("apiKey_" + id, "") ?: ""

    fun saveKey(context: Context, id: String, key: String) =
        prefs(context).edit().putString("apiKey_" + id, key.trim()).apply()

    // Ollama runs on the device and needs no key at all.
    fun isReady(context: Context): Boolean {
        val id = provider(context)
        return id == "ollama" || keyFor(context, id).isNotBlank()
    }
}
