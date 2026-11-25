#!/bin/bash
# scene.sh: the scene every picture starts from, in a sandbox that was just launched: six spaces
# with stand-in agents, the sidebar's folders, and the first space's editor on a source file.
# It writes ids.sh (S1..S6, T1, TERM1), which lib.sh reads.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
for i in $(seq 1 40); do herdr-app status >/dev/null 2>&1 && break; nap 0.7; done
herdr-app status >/dev/null 2>&1 || { echo "scene: the sandbox does not answer (launch.sh first)"; exit 1; }
# Out of the way, and out of the pointer's: a shot shows the window as well when it is minimized.
# Asked twice: the first may come before the window is there.
h window.minimize; nap 2; h window.minimize

# What a start brings back are plain shells: close them all.
for id in $(herdr-app ls | py -c 'import json, sys; [print(s["id"]) for s in json.load(sys.stdin)["spaces"]]'); do
  h space.close "{\"id\":\"$id\",\"confirmed\":true}"
done

# new <command> key value ...: `agent` is "app|state|title|screen file[|later state]", run by agents/run.sh
new() {
  herdr-app do "$1" "$(py - "$DEMO/agents" "${@:2}" <<'P'
import json, sys
agents, rest = sys.argv[1], sys.argv[2:]
d = {}
for k, v in zip(rest[::2], rest[1::2]):
    if k == "agent":
        a = v.split("|"); a[3] = f"{agents}/{a[3]}"; d["argv"] = [f"{agents}/run.sh"] + a
    elif k == "focus": d["focus"] = v == "true"
    else: d[k] = v
print(json.dumps(d))
P
)" | py -c 'import json, sys; d = json.load(sys.stdin); print(d.get("space", ""), d.get("tab", ""), d.get("error", ""))'
}
read -r S1 T1 _ < <(new space.new folder "$R" tab "initials" agent "claude-code|working|Two-letter initials|herdr-claude.txt")
new tab.new space "$S1" folder "$R" name "review" focus false agent "codex|idle|Review the minimap branch|herdr-codex.txt" >/dev/null
new tab.new space "$S1" folder "$R" name "shell" focus false >/dev/null
read -r S2 _ < <(new space.new folder "$D/atlas-api" tab "rate limits" focus false agent "codex|blocked:kind=permission|429 over the limit|atlas-codex.txt")
read -r S3 _ < <(new space.new folder "$D/nimbus-web" tab "theme header" focus false agent "claude-code|idle|Theme header|nimbus-claude.txt")
# This one finishes while nobody looks: it is drawn as done.
read -r S4 _ < <(new space.new folder "$D/ledger-cli" tab "rounding" focus false agent "claude-code|working|Fix negative cents|ledger-claude.txt|idle")
read -r S5 _ < <(new space.new folder "$D/quarry" tab "parquet" focus false agent "codex|working|Parquet export|quarry-codex.txt")
read -r S6 _ < <(new space.new folder "$D/fieldnotes" tab "notes" focus false)
nap 6
TERM1=$(terminal_of herdr-app initials)
printf 'S1=%s\nT1=%s\nTERM1=%s\nS2=%s\nS3=%s\nS4=%s\nS5=%s\nS6=%s\n' "$S1" "$T1" "$TERM1" "$S2" "$S3" "$S4" "$S5" "$S6" > "$DEMO/ids.sh"

req "$(folders_json)" 3
h layout.hide '{"id":"panel"}'; h layout.resize '{"id":"sidebar","px":290}'
h space.select "{\"id\":\"$S1\"}"; h tab.select '{"index":1}'; nap 2
# The editor pane beside the agent's terminal: asked for a file first, then split in.
stage "[{\"shared\":[\"file-editor.open\",{\"tab\":\"$T1\",\"path\":\"$R/mods/git-graph/git.js\",\"on\":null,\"select\":{\"line\":145,\"start\":2,\"end\":2},\"at\":\"now\"}]},{\"run\":[\"pane.split\",{\"direction\":\"right\",\"mod\":\"file-editor\",\"props\":{\"tab\":\"$T1\"}}]}]"
nap 1; draw 8; h pane.focus "{\"terminal\":\"$TERM1\"}"; draw 2
h window.minimize

herdr-app ls | py -c '
import json, sys
for s in json.load(sys.stdin)["spaces"]:
    for t in s["tabs"]:
        for x in t["terminals"]: print(s["name"], "|", t["name"], x["terminal"], x["status"])'
herdr-app status | py -c 'import json, sys; d = json.load(sys.stdin); print("zoom", d.get("zoom"), "errors", d.get("errors"))'
