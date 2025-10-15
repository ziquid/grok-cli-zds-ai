import { exec } from "child_process";
import * as path from "path";
import * as os from "os";

export interface HookResult {
  approved: boolean;
  reason?: string;
  timedOut: boolean;
}

export interface ToolApprovalResult {
  approved: boolean;
  reason?: string;
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

/**
 * Execute a hook with operation details passed via environment variables
 * Generic hook executor for operations that need validation
 * @param hookPath Path to hook script (supports ~/ expansion)
 * @param operation Operation type (e.g., "tool", "task", "persona", "mood")
 * @param data Key-value pairs to pass as environment variables
 * @param timeoutMs Timeout in milliseconds (default 30000)
 * @returns Promise<HookResult>
 */
export async function executeOperationHook(
  hookPath: string,
  operation: string,
  data: Record<string, any>,
  timeoutMs: number = 30000
): Promise<HookResult> {
  // Expand ~ to home directory
  const expandedPath = hookPath.startsWith("~/")
    ? path.join(os.homedir(), hookPath.slice(2))
    : hookPath;

  // Build environment using ZDS_AI_AGENT_* naming convention
  // Note: These variables are only set in the child process and are automatically
  // cleaned up when the child process exits. They do NOT modify the parent process environment.
  const env = {
    ...process.env,
    ZDS_AI_AGENT_OPERATION: operation,
  };

  // Add each data field as ZDS_AI_AGENT_<KEY>=<VALUE>
  for (const [key, value] of Object.entries(data)) {
    const envKey = `ZDS_AI_AGENT_${key.toUpperCase()}`;
    env[envKey] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  return new Promise((resolve) => {
    // Execute hook with isolated environment (child process only)
    const child = exec(expandedPath, { env, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        // Check if it was a timeout
        if (error.killed && error.signal === "SIGTERM") {
          // Timeout = auto-approve (don't block the agent)
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
            reason: stdout.trim() || stderr.trim() || "Operation denied by hook",
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

/**
 * Execute a tool approval hook with tool name and parameters passed via environment
 * @param hookPath Path to hook script (supports ~/ expansion)
 * @param toolName Name of the tool being executed
 * @param parameters Tool parameters as key-value pairs
 * @param timeoutMs Timeout in milliseconds (default 30000)
 * @returns Promise<ToolApprovalResult>
 */
export async function executeToolApprovalHook(
  hookPath: string,
  toolName: string,
  parameters: Record<string, any>,
  timeoutMs: number = 30000
): Promise<ToolApprovalResult> {
  // Expand ~ to home directory
  const expandedPath = hookPath.startsWith("~/")
    ? path.join(os.homedir(), hookPath.slice(2))
    : hookPath;

  // Build environment with tool info using ZDS_AI_AGENT_* naming convention
  // Note: These variables are only set in the child process and are automatically
  // cleaned up when the child process exits. They do NOT modify the parent process environment.
  const env = {
    ...process.env,
    ZDS_AI_AGENT_TOOL_NAME: toolName,
  };

  // Add each parameter as ZDS_AI_AGENT_TOOL_PARAM_<KEY>=<VALUE>
  for (const [key, value] of Object.entries(parameters)) {
    const envKey = `ZDS_AI_AGENT_TOOL_PARAM_${key.toUpperCase()}`;
    env[envKey] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  return new Promise((resolve) => {
    // Execute hook with isolated environment (child process only)
    const child = exec(expandedPath, { env, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        // Check if it was a timeout
        if (error.killed && error.signal === "SIGTERM") {
          // Timeout = auto-approve (don't block the agent)
          resolve({
            approved: true,
          });
          return;
        }

        // Non-zero exit code = rejected
        if (error.code && error.code > 0) {
          resolve({
            approved: false,
            reason: stdout.trim() || stderr.trim() || "Tool execution denied by hook",
          });
          return;
        }
      }

      // Exit code 0 = approved
      resolve({
        approved: true,
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
