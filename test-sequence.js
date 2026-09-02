const { extract, ACTIONS, promptSection } = require("./src/actions");

const results = [];
function check(name, cond, extra) {
  results.push(!!cond);
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "   -> " + extra));
}

function one(text, player) {
  return extract(text, player || "Bunny", []);
}

console.log("=== sequencing ===");

let r = one(
  "Here come the sounds!\n" +
    "ACTION playsound mob.cow.say\n" +
    "ACTION wait 1\n" +
    "ACTION playsound mob.pig.say"
);
check(
  "a sound sequence with a pause builds in order",
  r.actions.length === 3 &&
    r.actions[0].command === 'playsound mob.cow.say "Bunny"' &&
    r.actions[1].delay === 1000 &&
    !r.actions[1].command &&
    r.actions[2].command === 'playsound mob.pig.say "Bunny"',
  JSON.stringify(r.actions)
);
check("the spoken text survives the sequence", r.text === "Here come the sounds!", r.text);

const ten = [];
for (let i = 0; i < 10; i++) {
  ten.push("ACTION playsound mob.cow.say");
  ten.push("ACTION wait 1");
}
r = one(ten.join("\n"));
check("ten sounds with pauses all survive", r.actions.length === 20, String(r.actions.length));

r = one("ACTION wait 999");
check("a long wait is clamped to ten seconds", r.actions[0].delay === 10000, JSON.stringify(r.actions));

r = one("ACTION wait 0.01");
check("a tiny wait is raised to a usable pause", r.actions[0].delay === 200, JSON.stringify(r.actions));

const runaway = [];
for (let i = 0; i < 90; i++) runaway.push("ACTION give diamond 1");
r = one(runaway.join("\n"));
check("the action cap stops a runaway reply", r.actions.length === 60, String(r.actions.length));

console.log("\n=== new actions ===");

r = one("ACTION playsound ../../evil");
check("a bad sound name is rejected", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION playsound random.levelup");
check(
  "a normal sound works",
  r.actions[0].command === 'playsound random.levelup "Bunny"',
  JSON.stringify(r.actions)
);

r = one("ACTION title Hello there Bunny");
check(
  "title keeps multi word text",
  r.actions[0].command === 'title "Bunny" title Hello there Bunny',
  JSON.stringify(r.actions)
);

r = one("ACTION title bad text with a quote \" in it");
check("title rejects characters that could break the command", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION gamerule keepinventory true");
check(
  "an allowed gamerule works",
  r.actions[0].command === "gamerule keepinventory true",
  JSON.stringify(r.actions)
);

r = one("ACTION gamerule commandblocksenabled true");
check("an unlisted gamerule is rejected", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION gamerule keepinventory maybe");
check("a nonsense gamerule value is rejected", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION killmob player");
check("killmob cannot target players", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION killmob zombie");
check(
  "killmob targets only that mob type nearby",
  r.actions[0].command === "kill @e[type=minecraft:zombie,r=40]",
  JSON.stringify(r.actions)
);

r = one("ACTION setblock 10 20 30 stone");
check(
  "setblock works",
  r.actions[0].command === "setblock 10 20 30 minecraft:stone",
  JSON.stringify(r.actions)
);

r = one("ACTION setblock 10 20 30 stone; kill @a");
check(
  "injected text never reaches a setblock command",
  r.actions.every((a) => !/kill|;/.test(a.command || "")),
  JSON.stringify(r.actions)
);

r = one("ACTION enchant sharpness 99");
check(
  "enchant allows high levels",
  r.actions[0].command === 'enchant "Bunny" sharpness 99',
  JSON.stringify(r.actions)
);

r = one("ACTION damage 999");
check(
  "damage allows any amount",
  r.actions[0].command === 'damage "Bunny" 999',
  JSON.stringify(r.actions)
);

r = one("ACTION clear 8");
check(
  "clear builds a relative fill of air",
  r.actions[0].command === "fill ~-8 ~-8 ~-8 ~8 ~8 ~8 air",
  JSON.stringify(r.actions)
);

r = one("ACTION clear 8 leaves");
check(
  "a word like leaves expands into every real leaf block",
  r.actions.length > 5 &&
    r.actions.every((a) => /^fill .* air 0 replace \w+$/.test(a.command)) &&
    r.actions.some((a) => a.command.endsWith("oak_leaves")) &&
    r.actions.some((a) => a.command.endsWith("birch_leaves")) &&
    !r.actions.some((a) => a.command.endsWith(" leaves")),
  JSON.stringify(r.actions.map((a) => a.command.split(" ").pop()))
);

r = one("ACTION clear 10 tree");
check(
  "the word tree clears logs and leaves together",
  r.actions.some((a) => a.command.endsWith("oak_log")) &&
    r.actions.some((a) => a.command.endsWith("oak_leaves")),
  JSON.stringify(r.actions.map((a) => a.command.split(" ").pop()))
);

r = one("ACTION clear 6 oak_log oak_leaves");
check(
  "several block names can be given at once",
  r.actions.length === 2,
  JSON.stringify(r.actions.map((a) => a.command.split(" ").pop()))
);

r = one("ACTION clear 6 notarealblock!!");
check("a nonsense block name is rejected", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION clear 999");
check(
  "clear radius stops at the engine limit",
  r.actions[0].command === "fill ~-15 ~-15 ~-15 ~15 ~15 ~15 air",
  JSON.stringify(r.actions)
);

r = one("ACTION fill 0 60 0 500 65 10 stone");
check("an oversized fill is rejected", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION fill 0 60 0 ~5 65 10 stone");
check("a fill mixing absolute and relative is rejected", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION fill 0 60 0 10 65 10 stone");
check(
  "a normal fill works",
  r.actions[0].command === "fill 0 60 0 10 65 10 minecraft:stone",
  JSON.stringify(r.actions)
);

r = one("ACTION locate biome jungle");
check(
  "locate biome builds the right command",
  r.actions[0].command === "locate biome jungle" && r.actions[0].reportResult === true,
  JSON.stringify(r.actions)
);

r = one("ACTION locate structure village");
check(
  "locate structure works",
  r.actions[0].command === "locate structure village",
  JSON.stringify(r.actions)
);

r = one("ACTION locate desert");
check(
  "a bare name is treated as a biome",
  r.actions[0].command === "locate biome desert",
  JSON.stringify(r.actions)
);

r = one("ACTION locate biome minecraft:swamp");
check(
  "the namespace prefix is stripped",
  r.actions[0].command === "locate biome swamp",
  JSON.stringify(r.actions)
);

r = one("ACTION locate biome ../../bad");
check("a bad biome name is rejected", r.actions.length === 0, JSON.stringify(r.actions));

console.log("\n=== prompt ===");

const section = promptSection([]);
check("the prompt explains repeating a line", /write the line several times/.test(section), "missing");
check("the prompt explains wait", /ACTION wait/.test(section), "missing");
check(
  "every action appears in the prompt",
  Object.keys(ACTIONS).every((n) => section.includes("ACTION " + n)),
  Object.keys(ACTIONS).filter((n) => !section.includes("ACTION " + n)).join(",")
);

const failed = results.filter((x) => !x).length;
console.log("\n" + (results.length - failed) + "/" + results.length + " passed");
process.exit(failed ? 1 : 0);
