Bedrock AI for Android
======================

The same bridge the desktop app runs, inside an Android app, so the phone
serves localhost to its own copy of Minecraft.

Build it
--------
  node android/fetch-node.js     downloads libnode.so, once, ~55 MB
  node android/pack-bridge.js    copies ../src and the add-on into assets
  gradle :app:assembleDebug      from inside android/

APKs land in android/app/build/outputs/apk/debug/, one per architecture.
arm64-v8a is the one for a real phone.

Neither libnode.so nor the packed assets are committed: the first is 60 MB per
architecture, and the second is a copy of files that already live one directory
up. Both scripts are safe to re-run.

How it fits together
--------------------
  fetch-node.js    libnode.so from nodejs-mobile v18.20.4
  pack-bridge.js   ../src, ws, and AI_Companion.mcpack into assets
  node_bridge.cpp  starts node::Start on its own thread and pumps its stdout
                   into logcat. libnode exports the C++ entry point only -
                   there is no node_start symbol, despite what the samples show
  NodeEngine.kt    unpacks the assets, writes config.json, starts the thread
  BridgeService.kt a foreground service, which is the only way Android lets
                   this keep serving once the player switches to Minecraft
  MainActivity.kt  key, start, install the add-on, copy the command; once the
                   bridge is up it shows the desktop app's own page in a WebView

What does not work on a phone
-----------------------------
Android 11 and up will not let an app read Android/data/com.mojang.minecraftpe,
so there is no world list, no thumbnails and no direct install. The add-on is
handed to Minecraft as a .mcpack through the normal open-with flow instead.
Everything else - the AI, commands, live world data - works as it does on a PC.
