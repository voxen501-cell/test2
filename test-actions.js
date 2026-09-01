const { extract, promptSection, ACTIONS } = require("./src/actions");

const results = [];
function check(name, cond, extra) {
  results.push(!!cond);
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "   -> " + extra));
}

function one(text, player) {
  return extract(text, player || "Bunny", []);
}

console.log("=== happy path ===");

let r = one("Here you go!\nACTION give diamond 10");
check("give builds the right command", r.actions[0] && r.actions[0].command === 'give "Bunny" minecraft:diamond 10', JSON.stringify(r.actions));
check("the action line is stripped from what the player sees", r.text === "Here you go!", JSON.stringify(r.text));

r = one("ACTION time night");
check("time night works", r.actions[0].command === "time set night", JSON.stringify(r.actions));

r = one("ACTION tp 100 64 -200");
check("teleport to coordinates works", r.actions[0].command === 'tp "Bunny" 100 64 -200', JSON.stringify(r.actions));

r = one("ACTION tp Steve");
check("teleport to a player works", r.actions[0].command === 'tp "Bunny" "Steve"', JSON.stringify(r.actions));

r = one("ACTION weather thunder");
check("weather works", r.actions[0].command === "weather thunder", JSON.stringify(r.actions));

r = one("ACTION: give iron_ingot 3");
check("colon form is accepted", r.actions[0].command === 'give "Bunny" minecraft:iron_ingot 3', JSON.stringify(r.actions));

r = one("Sure.\nACTION time day\nACTION weather clear");
check("two actions in one reply both run", r.actions.length === 2, JSON.stringify(r.actions));

console.log("\n=== clamping and cleanup ===");

r = one("ACTION give diamond 9999");
check("count is clamped to 64", r.actions[0].command.endsWith(" 64"), r.actions[0].command);

r = one("ACTION give diamond 0");
check("count below one becomes one", r.actions[0].command.endsWith(" 1"), r.actions[0].command);

r = one("ACTION give minecraft:diamond 5");
check("namespace prefix is tolerated", r.actions[0].command === 'give "Bunny" minecraft:diamond 5', r.actions[0].command);

r = one("ACTION time 99999");
check("time is clamped to a day", r.actions[0].command === "time set 24000", r.actions[0].command);

r = one("ACTION xp 999999");
check("xp is clamped", r.actions[0].command === 'xp 5000 "Bunny"', r.actions[0].command);

r = one("ACTION effect speed 99999 99");
check("effect seconds and level are clamped", r.actions[0].command === 'effect "Bunny" speed 3600 4', r.actions[0].command);

console.log("\n=== safety ===");

r = one("ACTION kill @a");
check("kill is not an action", r.actions.length === 0 && r.rejected.includes("kill"), JSON.stringify(r));

r = one("ACTION give diamond 1; kill @a");
check(
  "trailing junk never reaches the command",
  r.actions.length === 1 &&
    r.actions[0].command === 'give "Bunny" minecraft:diamond 1' &&
    !r.actions[0].command.includes("kill") &&
    !r.actions[0].command.includes(";"),
  JSON.stringify(r.actions)
);

r = one("ACTION give diamond 1 && kill @a");
check(
  "shell style chaining never reaches the command",
  r.actions.length === 1 && !/kill|&&/.test(r.actions[0].command),
  JSON.stringify(r.actions)
);

r = one("ACTION tp 0 0 0\nkill @a");
check(
  "a bare command line after an action is treated as plain text",
  r.actions.length === 1 && r.text.includes("kill @a"),
  JSON.stringify(r)
);

r = one('ACTION give diamond" 1 kill @a');
check("a quote in the item is rejected", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION tp ~ ~ ~", 'Bad" Name');
check(
  "a hostile player name cannot break out of the quotes",
  !r.actions[0].command.includes('"Bad" Name"') && r.actions[0].command === 'tp "Bad Name" ~ ~ ~',
  r.actions[0].command
);

r = one("ACTION summon ender_dragon");
check("the ender dragon is blocked", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION give ../../etc/passwd 1");
check("a path style item is rejected", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION gamemode god");
check("an invalid game mode is rejected", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION time\nACTION weather\nACTION give");
check("actions with missing arguments are rejected", r.actions.length === 0, JSON.stringify(r.actions));

r = one("ACTION give a 1\nACTION give b 1\nACTION give c 1\nACTION give d 1");
check("several actions in one reply all run", r.actions.length === 4, JSON.stringify(r.actions.length));

r = extract("ACTION give diamond 10\nACTION time night", "Bunny", ["time"]);
check(
  "only actions on the allow list run",
  r.actions.length === 1 && r.actions[0].name === "time",
  JSON.stringify(r.actions)
);

console.log("\n=== text handling ===");

r = one("I cannot do that, there is no ACTION for it.");
check(
  "the word ACTION mid sentence is not treated as a command",
  r.actions.length === 0 && r.text.includes("no ACTION for it"),
  JSON.stringify(r)
);

r = one("ACTION give diamond 10");
check(
  "a reply that is only an action still says something",
  r.text === "",
  JSON.stringify(r.text)
);

const section = promptSection([]);
check("the prompt lists every action", Object.keys(ACTIONS).every((n) => section.includes(" " + n + " ") || section.includes(" " + n)), "missing some");
check("the prompt tells the model to refuse unknown requests", /cannot do it/.test(section), section.slice(-120));

const failed = results.filter((r) => !r).length;
console.log("\n" + (results.length - failed) + "/" + results.length + " passed");
process.exit(failed ? 1 : 0);
