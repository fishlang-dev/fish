// Runs git on what a manifest or registry names: never the user's hooks, Git LFS or a GIT_*
// variable pointing at another repository, and never prompting for a password.
export function git(cwd: string, ...args: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const quiet = ["-c", "core.hooksPath=/dev/null", "-c", "filter.lfs.process=", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.required=false"];
  // Only transports that fetch from a server or a directory; `fd::` and `ext::` could hang or run commands.
  const transports = ["-c", "protocol.allow=never", ...["https", "http", "ssh", "git", "file"].flatMap((p) => ["-c", `protocol.${p}.allow=always`])];
  return Bun.spawnSync(["git", ...quiet, ...transports, ...args], { cwd, stderr: "pipe", stdout: "pipe", env: { ...env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" } });
}

// The line of git's output that says what went wrong, skipping a push's "To <url>" and hints.
export const firstLine = (text: string) => text.trim().split("\n").find((l) => l.trim() !== "" && !/^(To |hint: )/.test(l))?.trim().replace(/^fatal: /, "") ?? "git failed";
