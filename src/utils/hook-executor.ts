import { exec, execSync } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

const ENV_PREFIX = "ZDS_AI_AGENT_";

/**
 * Expand tilde in path to home directory
 * Supports ~, ~/path, and ~username/path
 */
function expandTilde(filePath: string): string {
  if (!filePath.startsWith("~")) {
    return filePath;
  }

  // Handle ~ or ~/path (current user)
  if (filePath === "~" || filePath.startsWith("~/")) {
    return filePath.replace("~", os.homedir());
  }

  // Handle ~username/path (other users)
  // Extract username from ~username/path
  const match = filePath.match(/^~([^/]+)(\/.*)?$/);
  if (match) {
    const username = match[1];
    const restOfPath = match[2] || "";

    try {
      // Use shell to expand ~username
      const expandedHome = execSync(`eval echo ~${username}`, { encoding: 'utf-8' }).trim();
      return expandedHome + restOfPath;
    } catch (error) {
      // If expansion fails, return original path
      return filePath;
    }
  }

  return filePath;
}

export interface HookResult {
  approved: boolean;
  reason?: string;
  timedOut: boolean;
  commands?: HookCommand[];
}

export interface HookCommand {
  type: "ENV" | "TOOL_RESULT" | "ECHO" | "RUN" | "BACKEND" | "MODEL" | "SYSTEM" | "SYSTEM_FILE" | "BASE_URL" | "API_KEY_ENV_VAR" | "SET" | "SET_FILE" | "SET_TEMP_FILE" | "PREFILL";
  value: string;
}

/**
 * Parse hook output for command directives
 * Lines starting with "ENV ", "TOOL_RESULT ", "ECHO ", "RUN ", "BACKEND ", "MODEL ", "SYSTEM ", "SYSTEM_FILE ", "BASE_URL ", "API_KEY_ENV_VAR ", "SET ", "SET_FILE ", "SET_TEMP_FILE ", or "PREFILL " are commands
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
    } else if (line.startsWith("SYSTEM_FILE ")) {
      commands.push({ type: "SYSTEM_FILE", value: line.slice(12) });
    } else if (line.startsWith("SYSTEM ")) {
      commands.push({ type: "SYSTEM", value: line.slice(7) });
    } else if (line.startsWith("BASE_URL ")) {
      commands.push({ type: "BASE_URL", value: line.slice(9) });
    } else if (line.startsWith("API_KEY_ENV_VAR ")) {
      commands.push({ type: "API_KEY_ENV_VAR", value: line.slice(16) });
    } else if (line.startsWith("SET_TEMP_FILE ")) {
      commands.push({ type: "SET_TEMP_FILE", value: line.slice(14) });
    } else if (line.startsWith("SET_FILE ")) {
      commands.push({ type: "SET_FILE", value: line.slice(9) });
    } else if (line.startsWith("SET ")) {
      commands.push({ type: "SET", value: line.slice(4) });
    } else if (line.startsWith("PREFILL ")) {
      commands.push({ type: "PREFILL", value: line.slice(8) });
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
  model?: string;
  backend?: string;
  baseUrl?: string;
  apiKeyEnvVar?: string;
  prefill?: string;
  promptVars: Map<string, string>;
}

/**
 * Apply hook commands and return extracted values
 * ENV commands are applied to process.env (auto-prefixes ENV_PREFIX if not present)
 * ENV VAR= (empty value) will unset the variable
 * TOOL_RESULT commands are aggregated into a single string
 * SYSTEM commands are aggregated into a single string
 * SYSTEM_FILE commands read file contents (up to 20,000 bytes) and add to system string
 * MODEL commands set the model to use (last one wins if multiple)
 * BACKEND commands set the backend to use (last one wins if multiple)
 * BASE_URL commands set the base URL to use (last one wins if multiple)
 * API_KEY_ENV_VAR commands set the env var name for API key (last one wins if multiple)
 * PREFILL commands set assistant prefill text (last one wins if multiple)
 * SET commands set prompt variables (text limited to 10,000 bytes)
 * SET_FILE commands read file contents (up to 20,000 bytes) and set prompt variables
 * SET_TEMP_FILE commands read file contents (up to 20,000 bytes), set prompt variables, and delete file
 * Returns extracted values for caller to use
 */
export function applyHookCommands(commands: HookCommand[]): HookCommandResults {
  const env: Record<string, string> = {};
  const toolResultLines: string[] = [];
  const systemLines: string[] = [];
  const promptVars: Map<string, string> = new Map();
  let model: string | undefined = undefined;
  let backend: string | undefined = undefined;
  let baseUrl: string | undefined = undefined;
  let apiKeyEnvVar: string | undefined = undefined;
  let prefill: string | undefined = undefined;

  for (const cmd of commands) {
    if (cmd.type === "ENV") {
      // Parse "KEY=VALUE" - DO NOT apply to process.env yet, just extract
      const match = cmd.value.match(/^([A-Z_]+)=(.*)$/);
      if (match) {
        let [, key, value] = match;
        // If key doesn't start with ENV_PREFIX, prepend it
        if (!key.startsWith(ENV_PREFIX)) {
          key = `${ENV_PREFIX}${key}`;
        }
        // Store ALL env variables for caller to apply after test succeeds
        env[key] = value;
      }
    } else if (cmd.type === "TOOL_RESULT") {
      toolResultLines.push(cmd.value);
    } else if (cmd.type === "SYSTEM") {
      systemLines.push(cmd.value);
    } else if (cmd.type === "SYSTEM_FILE") {
      // Read file contents and add to system lines
      const filePath = cmd.value.trim();
      try {
        // Expand ~ to home directory
        const expandedPath = expandTilde(filePath);

        const MAX_FILE_SIZE = 20000;

        // Check file size first
        const stats = fs.statSync(expandedPath);

        if (stats.size > MAX_FILE_SIZE) {
          // File is too large - read only first 20k bytes
          const fd = fs.openSync(expandedPath, 'r');
          const buffer = Buffer.alloc(MAX_FILE_SIZE);
          fs.readSync(fd, buffer, 0, MAX_FILE_SIZE, 0);
          fs.closeSync(fd);
          const truncated = buffer.toString('utf-8');
          systemLines.push(`${truncated}\n\n[File truncated at ${MAX_FILE_SIZE} characters]`);
        } else {
          // File is small enough - read entire file
          const fileContents = fs.readFileSync(expandedPath, 'utf-8');
          systemLines.push(fileContents);
        }
      } catch (error) {
        // Add error message to system lines if file can't be read
        const errorMsg = error instanceof Error ? error.message : String(error);
        systemLines.push(`[Error reading file ${filePath}: ${errorMsg}]`);
      }
    } else if (cmd.type === "MODEL") {
      model = cmd.value.trim();
    } else if (cmd.type === "BACKEND") {
      backend = cmd.value.trim();
    } else if (cmd.type === "BASE_URL") {
      baseUrl = cmd.value.trim();
    } else if (cmd.type === "API_KEY_ENV_VAR") {
      apiKeyEnvVar = cmd.value.trim();
    } else if (cmd.type === "SET") {
      // Parse "VAR_NAME=value"
      const match = cmd.value.match(/^([A-Z]+:[A-Z]+)=(.*)$/);
      if (match) {
        const [, varName, value] = match;

        // Limit text values to 10,000 bytes
        const MAX_TEXT_SIZE = 10000;
        let finalValue = value;
        if (finalValue.length > MAX_TEXT_SIZE) {
          finalValue = finalValue.substring(0, MAX_TEXT_SIZE) + "\n\n[Text truncated at 10,000 bytes]";
        }

        promptVars.set(varName, finalValue);
      }
    } else if (cmd.type === "SET_FILE") {
      // Parse "VAR_NAME=/path/to/file"
      const match = cmd.value.match(/^([A-Z]+:[A-Z]+)=(.+)$/);
      if (match) {
        const [, varName, filePath] = match;

        try {
          const expandedPath = expandTilde(filePath);
          const MAX_FILE_SIZE = 20000;
          const stats = fs.statSync(expandedPath);

          let fileContents: string;
          if (stats.size > MAX_FILE_SIZE) {
            // File too large -- read first 20000 bytes
            const fd = fs.openSync(expandedPath, 'r');
            const buffer = Buffer.alloc(MAX_FILE_SIZE);
            fs.readSync(fd, buffer, 0, MAX_FILE_SIZE, 0);
            fs.closeSync(fd);
            fileContents = buffer.toString('utf-8') + `\n\n[File truncated at ${MAX_FILE_SIZE} characters]`;
          } else {
            // Read entire file
            fileContents = fs.readFileSync(expandedPath, 'utf-8');
          }

          promptVars.set(varName, fileContents);
        } catch (error) {
          // Add error to variable value
          const errorMsg = error instanceof Error ? error.message : String(error);
          promptVars.set(varName, `[Error reading file ${filePath}: ${errorMsg}]`);
        }
      }
    } else if (cmd.type === "SET_TEMP_FILE") {
      // Parse "VAR_NAME=/path/to/file"
      const match = cmd.value.match(/^([A-Z]+:[A-Z]+)=(.+)$/);
      if (match) {
        const [, varName, filePath] = match;

        try {
          const expandedPath = expandTilde(filePath);
          const MAX_FILE_SIZE = 20000;
          const stats = fs.statSync(expandedPath);

          let fileContents: string;
          if (stats.size > MAX_FILE_SIZE) {
            // File too large -- read first 20000 bytes
            const fd = fs.openSync(expandedPath, 'r');
            const buffer = Buffer.alloc(MAX_FILE_SIZE);
            fs.readSync(fd, buffer, 0, MAX_FILE_SIZE, 0);
            fs.closeSync(fd);
            fileContents = buffer.toString('utf-8') + `\n\n[File truncated at ${MAX_FILE_SIZE} characters]`;
          } else {
            // Read entire file
            fileContents = fs.readFileSync(expandedPath, 'utf-8');
          }

          promptVars.set(varName, fileContents);

          // Delete temp file after reading
          fs.unlinkSync(expandedPath);
        } catch (error) {
          // Add error to variable value (file might not exist or delete might fail)
          const errorMsg = error instanceof Error ? error.message : String(error);
          promptVars.set(varName, `[Error with temp file ${filePath}: ${errorMsg}]`);
        }
      }
    } else if (cmd.type === "PREFILL") {
      // PREFILL sets the assistant prefill text (last one wins if multiple)
      prefill = cmd.value;
    }
  }

  return {
    env,
    toolResult: toolResultLines.join("\n"),
    system: systemLines.join("\n"),
    model,
    backend,
    baseUrl,
    apiKeyEnvVar,
    prefill,
    promptVars,
  };
}

/**
 * Apply extracted ENV variables to process.env
 * Should be called AFTER model/backend tests succeed
 * @param env Environment variables to apply
 */
export function applyEnvVariables(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === '') {
      // Empty value means unset the variable
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
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
  mandatory: boolean = false,
  contextCurrent?: number,
  contextMax?: number
): Promise<HookResult> {
  // Expand ~ to home directory
  const expandedPath = expandTilde(hookPath);

  // Build environment using ZDS_AI_AGENT_* naming convention
  // Note: These variables are only set in the child process and are automatically
  // cleaned up when the child process exits. They do NOT modify the parent process environment.
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    [`${ENV_PREFIX}OPERATION`]: operation,
  };

  // Add context information if provided
  if (contextCurrent !== undefined) {
    env[`${ENV_PREFIX}CONTEXT_CURRENT`] = contextCurrent.toString();
  }
  if (contextMax !== undefined) {
    env[`${ENV_PREFIX}CONTEXT_MAX`] = contextMax.toString();
  }

  // Add each data field as ZDS_AI_AGENT_PARAM_<KEY>=<VALUE>
  for (const [key, value] of Object.entries(data)) {
    const envKey = `${ENV_PREFIX}PARAM_${key.toUpperCase()}`;
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
  timeoutMs: number = 30000,
  contextCurrent?: number,
  contextMax?: number
): Promise<HookResult> {
  // Expand ~ to home directory
  const expandedPath = expandTilde(hookPath);

  // Build environment with tool info using ZDS_AI_AGENT_* naming convention
  // Note: These variables are only set in the child process and are automatically
  // cleaned up when the child process exits. They do NOT modify the parent process environment.
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    [`${ENV_PREFIX}TOOL_NAME`]: toolName,
  };

  // Add context information if provided
  if (contextCurrent !== undefined) {
    env[`${ENV_PREFIX}CONTEXT_CURRENT`] = contextCurrent.toString();
  }
  if (contextMax !== undefined) {
    env[`${ENV_PREFIX}CONTEXT_MAX`] = contextMax.toString();
  }

  // Add each parameter as ZDS_AI_AGENT_PARAM_<KEY>=<VALUE>
  for (const [key, value] of Object.entries(parameters)) {
    const envKey = `${ENV_PREFIX}PARAM_${key.toUpperCase()}`;
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
