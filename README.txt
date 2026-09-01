AI COMPANION - SETUP


WHAT THIS IS

Minecraft Bedrock cannot reach the internet from inside an addon.
So this comes in two halves:

  1. AI Companion.mcpack   the addon, install it in Minecraft
  2. this bridge folder    a small program that runs on your computer

The bridge listens for your chat, asks a real AI, and sends the answer
back into the game. Both halves must be running.


STEP 1 - INSTALL NODE.JS

Get it from https://nodejs.org and install it. Any recent version works.


STEP 2 - GET A FREE API KEY

The bridge works with several AI services. Pick one:

  groq        https://console.groq.com/keys      free, very fast, no card
  gemini      https://aistudio.google.com/apikey free tier, no card
  openrouter  https://openrouter.ai/keys         has free models
  ollama      https://ollama.com/download        runs on your own PC, no key
  claude      https://console.anthropic.com      paid, best quality

Open config.json and fill in:

  "provider": "groq",
  "apiKey":   "paste your key here"

Leave "model" empty to use that provider's default.


STEP 3 - START THE BRIDGE

Double click start.bat

It should print:  Listening on port 8080


STEP 4 - CONNECT MINECRAFT

Install AI Companion.mcpack and add it to your world.
Turn cheats on for that world.

In game, type in chat:

  /connect localhost:8080

You should see: AI companion connected.


STEP 5 - TALK

Just type in chat, no prefix needed:

  how do I find diamonds
  give me 10 diamonds
  make it night
  teleport me to 0 100 0

It remembers your conversation, and it can see where you are, what you
are standing on, your health, what you are holding, the time and the
weather.

  ai reset     forget the conversation
  ai off       stop replying to plain chat, require the ai prefix again
  ai on        reply to every message again
  ai debug     show exactly what the AI is being told


WHAT IT CAN DO FOR YOU

  give an item          give me 10 diamonds
  set the time          make it night
  change the weather    stop the rain
  teleport              take me to 0 100 0, or teleport me to Steve
  game mode             put me in creative
  status effects        give me speed for a minute
  heal                  heal me
  hurt                  take two hearts off me
  difficulty            set it to hard
  spawn mobs            spawn a baby villager, or spawn 5 cows
  remove mobs           get rid of the zombies around here
  experience            give me 500 xp
  play a sound          play a creeper sound
  stop sounds           stop that noise
  particles             show some hearts
  big screen text       put Hello on my screen
  hotbar text           show ready above my hotbar
  place a block         put stone at 10 20 30
  enchant               put sharpness 5 on my sword
  set spawn             make this my respawn point
  game rules            turn on keepinventory
  shake the camera      shake my screen for 3 seconds
  fog                   give me spooky fog

It can also do several of those in a row, with pauses. Ask for five
different mob sounds one after another and it will space them out.

It can only do the things on that list. It cannot run arbitrary commands,
so it cannot kill players, wipe your inventory or change your world in
ways you did not ask for. Counts are capped: 64 items, 5000 xp, 10 mobs,
20 actions in one reply, and only game rules from a safe list.

To turn actions off entirely, set allowActions to false in config.json.
To allow only some, list them in actionsAllowed, for example
["give", "time"].

Open the in game menu with either of these:

  /scriptevent voxai:menu
  sneak and use a Book


SETTINGS IN config.json

  provider      which AI service to use
  apiKey        your key for that service
  model         leave empty for the default
  maxTokens     how long answers can be
  port          must match the port in your /connect command
  trigger       the word that starts a question, default "ai"
  defaultAlwaysOn  true means no prefix is needed, just type normally
  allowActions  whether the AI may act in the world
  actionsAllowed  empty for all actions, or a list like ["give","time"]
  useGameContext  whether the AI can see the world around you
  reasoningEffort low keeps reasoning models from using up all the tokens
  output        "addon" for the nice in game display
                "chat" if you are running without the addon
  historyTurns  how many past exchanges it remembers
  cooldownMs    minimum gap between questions
  maxPerMinute  cap per player per minute
  systemPrompt  the personality, edit this freely


PLAYING WITH FRIENDS

Everyone who wants to talk to the AI runs /connect themselves.
If the bridge runs on another computer, use its address instead of
localhost, and make sure port 8080 is open on that machine.


TROUBLESHOOTING

Nothing happens after /connect
  Cheats must be on. The bridge must already be running.

Could not connect
  Wrong port, or a firewall blocked it. Allow Node.js when Windows asks.

AI error: HTTP 401
  The key in config.json is wrong or has no spaces trimmed.

AI error: HTTP 400 or 404 saying the model does not exist
  Providers retire models often. Put a current model name in "model".
  Current defaults: groq openai/gpt-oss-120b, gemini gemini-2.0-flash.
  To see what your groq key can use right now, run:
    node list-models.js

AI error: HTTP 429
  You hit the free tier rate limit. Wait, or switch provider.

Answers are cut off
  Raise maxTokens in config.json.
