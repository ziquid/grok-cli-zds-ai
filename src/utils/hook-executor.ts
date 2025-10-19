import { exec } from "child_process";
import * as path from "path";
import * as os from "os";

export interface HookResult {
  approved: boolean;
  reason?: string;
  timedOut: boolean;
  commands?: HookCommand[];
}

export interface HookCommand {
  type: "ENV" | "TOOL_RESULT" | "ECHO" | "RUN" | "BACKEND" | "MODEL" | "SYSTEM";
  value: string;
}

/**
 * Parse hook output for command directives
 * Lines starting with "ENV ", "TOOL_RESULT ", "ECHO ", "RUN ", "BACKEND ", "MODEL ", or "SYSTEM " are commands
 * Other lines are treated as TOOL_RESULT if present
 */
function parseHookOutput(stdout: string): HookCommand[] {
  const commands: HookCommand[] = [];
  const lines = stdout.split("\n").filter((line) => line.trim());

  for (const line of lines) {
    if (line.startsWith("ENV ")) {
      commands.push({ type: "ENV", value: line.slice(4) });
    } else if (line.startsWith("TOOL_RESULT ")) {
      commands.push({ type: "TOOL_RESULT", value: line.slice(12) });
    } else if (line.startsWith("ECHO ")) {
      commands.push({ type: "ECHO", value: line.slice(5) });
    } else if (line.startsWith("RUN ")) {
      commands.push({ type: "RUN", value: line.slice(4) });
    } else if (line.startsWith("BACKEND ")) {
      commands.push({ type: "BACKEND", value: line.slice(8) });
    } else if (line.startsWith("MODEL ")) {
      commands.push({ type: "MODEL", value: line.slice(6) });
    } else if (line.startsWith("SYSTEM ")) {
      commands.push({ type: "SYSTEM", value: line.slice(7) });
    } else if (line.trim()) {
      // Non-empty lines without a command prefix are treated as TOOL_RESULT
      commands.push({ type: "TOOL_RESULT", value: line });
    }
  }

  return commands;
}

export interface HookCommandResults {
  env: Record<string, string>;
  toolResult: string;
  system: string;
}

/**
 * Apply hook commands and return extracted values
 * ENV commands are applied to process.env
 * TOOL_RESULT commands are aggregated into a single string
 * SYSTEM commands are aggregated into a single string
 * Returns extracted values for caller to use
 */
export function applyHookCommands(commands: HookCommand[]): HookCommandResults {
  const env: Record<string, string> = {};
  const toolResultLines: string[] = [];
  const systemLines: string[] = [];

  for (const cmd of commands) {
    if (cmd.type === "ENV") {
      // Parse "KEY=VALUE" and apply to process environment
      const match = cmd.value.match(/^([A-Z_]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        process.env[key] = value;
        // Also extract special variables for caller to use
        if (key.startsWith("ZDS_AI_AGENT_")) {
          env[key] = value;
        }
      }
    } else if (cmd.type === "TOOL_RESULT") {
      toolResultLines.push(cmd.value);
    } else if (cmd.type === "SYSTEM") {
      systemLines.push(cmd.value);
    }
  }

  return {
    env,
    toolResult: toolResultLines.join("\n"),
    system: systemLines.join("\n"),
  };
}

/**
 * Execute a hook with operation details passed via environment variables
 * Generic hook executor for operations that need validation
 * @param hookPath Path to hook script (supports ~/ expansion)
 * @param operation Operation type (e.g., "tool", "task", "persona", "mood")
 * @param data Key-value pairs to pass as environment variables
 * @param timeoutMs Timeout in milliseconds (default 30000)
 * @param mandatory If true, timeout rejects instead of auto-approving
 * @returns Promise<HookResult>
 */
export async function executeOperationHook(
  hookPath: string,
  operation: string,
  data: Record<string, any>,
  timeoutMs: number = 30000,
  mandatory: boolean = false
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

  // Add each data field as ZDS_AI_AGENT_PARAM_<KEY>=<VALUE>
  for (const [key, value] of Object.entries(data)) {
    const envKey = `ZDS_AI_AGENT_PARAM_${key.toUpperCase()}`;
    env[envKey] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  return new Promise((resolve) => {
    // Execute hook with isolated environment (child process only)
    const child = exec(expandedPath, { env, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        // Check if it was a timeout
        if (error.killed && error.signal === "SIGTERM") {
          // Timeout behavior depends on whether hook is mandatory
          if (mandatory) {
            // Mandatory hook timeout = reject
            resolve({
              approved: false,
              reason: "Hook timed out and is mandatory",
              timedOut: true,
            });
          } else {
            // Non-mandatory hook timeout = auto-approve (don't block the agent)
            resolve({
              approved: true,
              timedOut: true,
            });
          }
          return;
        }

        // Non-zero exit code = rejected
        if (error.code && error.code > 0) {
          // Parse commands even on rejection
          const commands = parseHookOutput(stdout);

          // Extract TOOL_RESULT commands as the denial reason
          const toolResultLines: string[] = [];
          for (const cmd of commands) {
            if (cmd.type === "TOOL_RESULT") {
              toolResultLines.push(cmd.value);
            }
          }

          const reason = toolResultLines.length > 0
            ? toolResultLines.join("\n")
            : (stdout.trim() || stderr.trim() || "Operation denied by hook");

          resolve({
            approved: false,
            reason,
            timedOut: false,
            commands,
          });
          return;
        }
      }

      // Exit code 0 = approved
      const commands = parseHookOutput(stdout);
      resolve({
        approved: true,
        timedOut: false,
        commands,
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
 * @returns Promise<HookResult>
 */
export async function executeToolApprovalHook(
  hookPath: string,
  toolName: string,
  parameters: Record<string, any>,
  timeoutMs: number = 30000
): Promise<HookResult> {
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

  // Add each parameter as ZDS_AI_AGENT_PARAM_<KEY>=<VALUE>
  for (const [key, value] of Object.entries(parameters)) {
    const envKey = `ZDS_AI_AGENT_PARAM_${key.toUpperCase()}`;
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
          // Parse commands even on rejection
          const commands = parseHookOutput(stdout);

          // Extract TOOL_RESULT commands as the denial reason
          const toolResultLines: string[] = [];
          for (const cmd of commands) {
            if (cmd.type === "TOOL_RESULT") {
              toolResultLines.push(cmd.value);
            }
          }

          const reason = toolResultLines.length > 0
            ? toolResultLines.join("\n")
            : (stdout.trim() || stderr.trim() || "Tool execution denied by hook");

          resolve({
            approved: false,
            reason,
            timedOut: false,
            commands,
          });
          return;
        }
      }

      // Exit code 0 = approved
      const commands = parseHookOutput(stdout);
      resolve({
        approved: true,
        timedOut: false,
        commands,
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
