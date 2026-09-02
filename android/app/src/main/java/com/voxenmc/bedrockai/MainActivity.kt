package com.voxenmc.bedrockai

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

// One screen: put a key in, press start, install the add-on, go and play. Once
// the bridge is up the same page the desktop app shows is loaded into a
// WebView, so there is one interface rather than two.
class MainActivity : AppCompatActivity() {

    private lateinit var status: TextView
    private lateinit var start: Button
    private lateinit var web: WebView

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        setContentView(R.layout.activity_main)

        status = findViewById(R.id.status)
        start = findViewById(R.id.start)
        web = findViewById(R.id.web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = WebViewClient()

        askForNotifications()

        findViewById<Button>(R.id.saveKey).setOnClickListener {
            val key = findViewById<EditText>(R.id.key).text.toString()
            if (key.isBlank()) {
                toast("Paste your API key first")
            } else {
                NodeEngine.saveKey(this, key)
                toast("Key saved")
                refresh()
            }
        }

        start.setOnClickListener {
            if (!NodeEngine.hasKey(this)) {
                toast("Add an API key first")
                return@setOnClickListener
            }
            startBridge()
        }

        findViewById<Button>(R.id.install).setOnClickListener { installAddon() }

        findViewById<Button>(R.id.copy).setOnClickListener {
            val text = "/connect localhost:${NodeEngine.PORT}"
            (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                .setPrimaryClip(ClipData.newPlainText("connect", text))
            toast("Copied - paste it in Minecraft chat")
        }

        findViewById<TextView>(R.id.command).text = "/connect localhost:${NodeEngine.PORT}"
        refresh()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun startBridge() {
        val intent = Intent(this, BridgeService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent)
        else startService(intent)
        status.text = "Starting the AI..."
        // the http server needs a moment before the page will load
        web.postDelayed({ refresh() }, 2500)
    }

    // Minecraft imports a .mcpack through the normal open-with flow; the app
    // cannot write into com.mojang itself on Android 11 and up.
    private fun installAddon() {
        try {
            val out = File(cacheDir, "BedrockAI.mcpack")
            assets.open("BedrockAI.mcpack").use { input ->
                out.outputStream().use { input.copyTo(it) }
            }
            val uri = FileProvider.getUriForFile(this, "$packageName.files", out)
            val open = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/octet-stream")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            startActivity(Intent.createChooser(open, "Open with Minecraft"))
        } catch (e: Exception) {
            toast("Could not open the add-on: ${e.message}")
        }
    }

    private fun refresh() {
        Thread {
            val up = reachable()
            runOnUiThread {
                if (up) {
                    status.text = "AI is running"
                    start.text = "Running"
                    start.isEnabled = false
                    if (web.url == null) web.loadUrl("http://localhost:${NodeEngine.PORT}/")
                    web.visibility = View.VISIBLE
                    findViewById<View>(R.id.setup).visibility = View.GONE
                } else {
                    status.text =
                        if (NodeEngine.hasKey(this)) "Ready to start" else "Add your API key"
                    start.text = "Start AI"
                    start.isEnabled = true
                    web.visibility = View.GONE
                    findViewById<View>(R.id.setup).visibility = View.VISIBLE
                }
            }
        }.start()
    }

    private fun reachable(): Boolean = try {
        val c = URL("http://127.0.0.1:${NodeEngine.PORT}/status").openConnection()
                as HttpURLConnection
        c.connectTimeout = 800
        c.readTimeout = 800
        val ok = c.responseCode in 200..299
        c.disconnect()
        ok
    } catch (e: Exception) {
        false
    }

    private fun askForNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) return
        ActivityCompat.requestPermissions(
            this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7)
    }

    private fun toast(text: String) =
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
}
