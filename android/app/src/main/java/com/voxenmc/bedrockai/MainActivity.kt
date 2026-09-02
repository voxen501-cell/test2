package com.voxenmc.bedrockai

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.view.View
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

// One screen, and it stays that screen: key, start, add-on, command. The
// desktop app's page is not shown here - its main view is the world list, and
// a phone cannot read com.mojang to fill one, so it would only ever be empty.
class MainActivity : AppCompatActivity() {

    private lateinit var status: TextView
    private lateinit var start: Button
    private var running = false

    // service id, label, and where its key comes from
    private data class Service(val id: String, val label: String, val keyUrl: String)

    private val services = listOf(
        Service("groq", "Groq  (free)", "console.groq.com/keys"),
        Service("gemini", "Google Gemini  (free)", "aistudio.google.com/apikey"),
        Service("openrouter", "OpenRouter", "openrouter.ai/keys"),
        Service("claude", "Claude  (paid)", "console.anthropic.com"),
        Service("ollama", "Ollama  (on this device, no key)", ""),
    )

    private val ticker = Handler(Looper.getMainLooper())

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        setContentView(R.layout.activity_main)

        status = findViewById(R.id.status)
        start = findViewById(R.id.start)
        askForNotifications()

        findViewById<Button>(R.id.saveKey).setOnClickListener {
            val typed = findViewById<EditText>(R.id.key).text.toString()
            if (typed.isBlank()) {
                toast("Paste a key from " + currentService().label.substringBefore("  "))
            } else {
                NodeEngine.saveKey(this, NodeEngine.provider(this), typed)
                toast("Key saved")
                refresh()
            }
        }

        // one button, both ways: the bridge is either up or it is not
        start.setOnClickListener {
            if (running) {
                stopBridge()
            } else if (!NodeEngine.isReady(this)) {
                toast("Add a key for " + currentService().label.substringBefore("  ") + " first")
            } else {
                startBridge()
            }
        }

        setUpServicePicker()

        // a key is worth hiding, but a mistyped one is worth seeing
        val key = findViewById<EditText>(R.id.key)
        findViewById<Button>(R.id.reveal).setOnClickListener {
            val hidden = key.inputType and InputType.TYPE_TEXT_VARIATION_PASSWORD != 0
            key.inputType = if (hidden) {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            } else {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            }
            (it as Button).text = if (hidden) "Hide" else "Show"
            key.setSelection(key.text.length)
        }

        findViewById<Button>(R.id.install).setOnClickListener { installAddon() }

        findViewById<Button>(R.id.openChat).setOnClickListener { showConversation() }

        findViewById<Button>(R.id.kofi).setOnClickListener {
            try {
                startActivity(Intent(Intent.ACTION_VIEW,
                    android.net.Uri.parse("https://ko-fi.com/D1D21NM7NS")))
            } catch (e: Exception) {
                toast("No browser to open that with")
            }
        }

        findViewById<Button>(R.id.copy).setOnClickListener {
            val text = "/connect localhost:${NodeEngine.PORT}"
            (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                .setPrimaryClip(ClipData.newPlainText("connect", text))
            toast("Copied - paste it in Minecraft chat")
        }

        findViewById<TextView>(R.id.command).text = "/connect localhost:${NodeEngine.PORT}"
        refresh()
    }

    private fun currentService(): Service =
        services.firstOrNull { it.id == NodeEngine.provider(this) } ?: services[0]

    private fun setUpServicePicker() {
        val spinner = findViewById<Spinner>(R.id.provider)
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item,
            services.map { it.label })
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinner.adapter = adapter
        spinner.setSelection(services.indexOfFirst { it.id == NodeEngine.provider(this) }
            .coerceAtLeast(0))

        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                val picked = services[pos]
                NodeEngine.setProvider(this@MainActivity, picked.id)
                // the key box follows the service, so switching back shows the
                // key that was already entered for it
                findViewById<EditText>(R.id.key)
                    .setText(NodeEngine.keyFor(this@MainActivity, picked.id))
                showKeyHint(picked)
                refresh()
            }

            override fun onNothingSelected(p: AdapterView<*>?) {}
        }
        showKeyHint(currentService())
    }

    private fun showKeyHint(service: Service) {
        val hint = findViewById<TextView>(R.id.keyHint)
        val key = findViewById<EditText>(R.id.key)
        val needsKey = service.keyUrl.isNotEmpty()
        hint.text = if (needsKey) "Key from " + service.keyUrl
                    else "Runs on this device. No key needed."
        key.visibility = if (needsKey) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.reveal).visibility =
            if (needsKey) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.saveKey).visibility =
            if (needsKey) View.VISIBLE else View.GONE
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
        start.isEnabled = false
        // node needs a moment to come up before the check will see it
        status.postDelayed({ refresh() }, 2500)
    }

    // The bridge runs in its own process, so ending it leaves this screen up.
    private fun stopBridge() {
        startService(Intent(this, BridgeService::class.java).setAction(BridgeService.ACTION_STOP))
        status.text = "Stopping..."
        start.isEnabled = false
        status.postDelayed({ refresh() }, 1200)
    }

    // Kept out of the main screen: it grows without limit, and a player who
    // wants to read it back can ask for it.
    private fun showConversation() {
        val view = layoutInflater.inflate(R.layout.dialog_chat, null)
        val text = view.findViewById<TextView>(R.id.chatText)
        val dialog = android.app.Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        dialog.setContentView(view)

        val refresh = object : Runnable {
            override fun run() {
                fetchChat { lines ->
                    if (!lines.isNullOrBlank()) {
                        text.text = lines
                        view.findViewById<ScrollView>(R.id.chatScroll).post {
                            view.findViewById<ScrollView>(R.id.chatScroll)
                                .fullScroll(View.FOCUS_DOWN)
                        }
                    } else {
                        text.text = if (running) "Nothing said yet."
                                    else "Start the AI first, then talk to it in Minecraft."
                    }
                }
                ticker.postDelayed(this, 2000)
            }
        }

        view.findViewById<Button>(R.id.chatClose).setOnClickListener { dialog.dismiss() }
        dialog.setOnDismissListener { ticker.removeCallbacks(refresh) }
        dialog.show()
        ticker.post(refresh)
    }

    private fun fetchChat(then: (String?) -> Unit) {
        Thread {
            val text = try {
                val c = URL("http://127.0.0.1:${NodeEngine.PORT}/chat").openConnection()
                        as HttpURLConnection
                c.connectTimeout = 900
                c.readTimeout = 900
                val body = c.inputStream.bufferedReader().readText()
                c.disconnect()
                val lines = JSONObject(body).getJSONArray("chat")
                val out = StringBuilder()
                for (i in 0 until lines.length()) {
                    val m = lines.getJSONObject(i)
                    if (out.isNotEmpty()) out.appendLine().appendLine()
                    out.append(m.getString("who")).append(":  ").append(m.getString("text"))
                }
                out.toString()
            } catch (e: Exception) {
                null
            }
            runOnUiThread { then(text) }
        }.start()
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
                running = up
                start.isEnabled = true
                if (up) {
                    status.text = "AI is running - go and play"
                    start.text = "Stop AI"
                    start.setBackgroundResource(R.drawable.btn_red)
                    start.setTextColor(getColor(R.color.ink))
                } else {
                    status.text =
                        if (NodeEngine.isReady(this)) "Ready to start" else "Add your API key"
                    start.text = "Start AI"
                    start.setBackgroundResource(R.drawable.btn_green)
                    start.setTextColor(getColor(R.color.green_ink))
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
