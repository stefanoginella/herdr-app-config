// Staging for pictures: runs the steps in stage.json (in the app's home), then closes itself.
// It is put in the sandbox's mods by build.sh, never in this setup's own.
// A step: { shared: [key, value] }   set shared state; a value's `at: "now"` becomes the time
//         { overlay: {...} }         openOverlay(...); its id is left in shared `stage.last`
//         { run: [command, args] }   run an app command
import { View, div } from "gpui-kit";
import { props, setShared, openOverlay, closeOverlay, run, readTextFile, appHome, checking } from "herdr";

export default class Stage extends View {
  init(_p, cx) {
    if (checking()) return;
    const overlay = props()?.overlay;
    cx.spawn(async () => {
      await null;
      try {
        const steps = JSON.parse(await readTextFile(`${appHome()}/stage.json`));
        for (const s of steps) {
          if (s.shared) { const v = s.shared[1]; setShared(s.shared[0], v && typeof v === "object" && v.at === "now" ? { ...v, at: Date.now() } : v); }
          else if (s.overlay) setShared("stage.last", openOverlay(s.overlay));
          else if (s.run) run(s.run[0], s.run[1] ?? {});
        }
        setShared("stage.error", null);
      } catch (e) { setShared("stage.error", String(e?.message ?? e)); }
      closeOverlay(overlay);
    });
  }
  render() { return div(); }
}
