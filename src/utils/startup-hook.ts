import { getSettingsManager } from "./settings-manager.js";
import { GrokAgent } from "../agent/grok-agent.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Execute the startup hook command if configured
 * Returns the output to be added to the system prompt
 */
export async function executeStartupHook(): Promise<string | undefined> {
  const manager = getSettingsManager();
  const startupHook = manager.getStartupHook();

  if (!startupHook) {
    return undefined;
  }

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const { stdout, stderr } = await execAsync(startupHook, {
      timeout: 10000, // 10 second timeout
      maxBuffer: 1024 * 1024, // 1MB max output
      shell,
    });

    // Combine stdout and stderr
    const output = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : "")).trim();
    return output || undefined;
  } catch (error: any) {
    console.warn("Startup hook failed:", error.message);
    return undefined;
  }
}

/**
 * Create a GrokAgent with startup hook execution and initialization
 * @param runStartupHook - Whether to run the startup hook (default: true, set false for restored sessions)
 */
export async function createGrokAgent(
  apiKey: string,
  baseURL?: string,
  model?: string,
  maxToolRounds?: number,
  debugLogFile?: string,
  runStartupHook: boolean = true
): Promise<GrokAgent> {
  const startupHookOutput = runStartupHook ? await executeStartupHook() : undefined;
  const agent = new GrokAgent(apiKey, baseURL, model, maxToolRounds, debugLogFile, startupHookOutput);
  await agent.initialize();
  return agent;
}