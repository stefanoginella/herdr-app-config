// Herdr gives the `task` to the agent as the last argument of `argv`. Some agents
// do not read a prompt from a bare argument: Antigravity (agy) reads it only after -i.
const PROMPT_FLAG = { agy: "-i" };

/** The `argv` and `task` fields for `space.new` or `tab.new` that start this agent with this first message. */
export function agentStart(argv, task) {
  const prog = String(argv?.[0] ?? "").split(/[\\/]/).pop().replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
  const flag = PROMPT_FLAG[prog];
  if (flag && task) return { argv: [...argv, flag, task] };
  return task ? { argv, task } : { argv };
}
