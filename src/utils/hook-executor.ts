import { exec } from "child_process";
import * as path from "path";
import * as os from "os";

export interface HookResult {
  approved: boolean;
  reason?: string;
  timedOut: boolean;
}

/**
 * Execute a hook script with timeout
 * @param hookPath Path to hook script (supports ~/ expansion)
 * @param args Arguments to pass to the hook
 * @param timeoutMs Timeout in milliseconds (default 30000)
 * @returns Promise<HookResult>
 */
export async function executeHook(
  hookPath: string,
  args: string[],
  timeoutMs: number = 30000
): Promise<HookResult> {
  // Expand ~ to home directory
  const expandedPath = hookPath.startsWith("~/")
    ? path.join(os.homedir(), hookPath.slice(2))
    : hookPath;

  // Build command with args
  const escapedArgs = args.map((arg) => `"${arg.replace(/"/g, '\\"')}"`);
  const command = `${expandedPath} ${escapedArgs.join(" ")}`;

  return new Promise((resolve) => {
    const child = exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        // Check if it was a timeout
        if (error.killed && error.signal === "SIGTERM") {
          // Timeout = auto-approve
          resolve({
            approved: true,
            timedOut: true,
          });
          return;
        }

        // Non-zero exit code = rejected
        if (error.code && error.code > 0) {
          resolve({
            approved: false,
            reason: stdout.trim() || stderr.trim() || "Hook rejected with no reason",
            timedOut: false,
          });
          return;
        }
      }

      // Exit code 0 = approved
      resolve({
        approved: true,
        timedOut: false,
      });
    });

    // Handle timeout explicitly
    setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch (e) {
        // Process may have already exited
      }
    }, timeoutMs);
  });
}
