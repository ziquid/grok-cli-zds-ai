import { ToolResult } from "../types/index.js";
import { ToolDiscovery } from "./tool-discovery.js";
import { executeOperationHook, applyHookCommands } from "../utils/hook-executor.js";
import { getSettingsManager } from "../utils/settings-manager.js";

export class CharacterTool implements ToolDiscovery {
  private agent: any; // Reference to the GrokAgent

  setAgent(agent: any) {
    this.agent = agent;
  }

  getHandledToolNames(): string[] {
    return ["setPersona", "setMood", "getPersona", "getMood", "getAvailablePersonas"];
  }

  /**
   * Set the persona display text in the status bar
   */
  async setPersona(persona: string, color?: string): Promise<ToolResult> {
    try {
      if (!this.agent) {
        return {
          success: false,
          error: "Agent not available",
          output: "Agent not available"
        };
      }

      // Set the persona (now async with hook support)
      const result = await this.agent.setPersona(persona, color);

      if (!result.success) {
        return {
          success: false,
          error: result.error || "Failed to set persona",
          output: result.error || "Failed to set persona"
        };
      }

      return {
        success: true,
        output: `Persona set to: ${persona}${color ? ` (color: ${color})` : ''}`,
        displayOutput: `Persona updated`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error setting persona",
        output: error instanceof Error ? error.message : "Unknown error setting persona"
      };
    }
  }

  /**
   * Set the mood display text in the status bar
   */
  async setMood(mood: string, color?: string): Promise<ToolResult> {
    try {
      if (!this.agent) {
        return {
          success: false,
          error: "Agent not available",
          output: "Agent not available"
        };
      }

      // Set the mood (now async with hook support)
      const result = await this.agent.setMood(mood, color);

      if (!result.success) {
        return {
          success: false,
          error: result.error || "Failed to set mood",
          output: result.error || "Failed to set mood"
        };
      }

      return {
        success: true,
        output: `Mood set to: ${mood}${color ? ` (color: ${color})` : ''}`,
        displayOutput: `Mood updated`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error setting mood",
        output: error instanceof Error ? error.message : "Unknown error setting mood"
      };
    }
  }

  /**
   * Get the current persona display text and color
   */
  async getPersona(): Promise<ToolResult> {
    try {
      if (!this.agent) {
        return {
          success: false,
          error: "Agent not available",
          output: "Agent not available"
        };
      }

      const persona = this.agent.persona || "";
      const color = this.agent.personaColor || "white";

      return {
        success: true,
        output: `Current persona: "${persona}" (color: ${color})`,
        displayOutput: `Persona: ${persona}`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error getting persona",
        output: error instanceof Error ? error.message : "Unknown error getting persona"
      };
    }
  }

  /**
   * Get the current mood display text and color
   */
  async getMood(): Promise<ToolResult> {
    try {
      if (!this.agent) {
        return {
          success: false,
          error: "Agent not available",
          output: "Agent not available"
        };
      }

      const mood = this.agent.mood || "";
      const color = this.agent.moodColor || "white";

      return {
        success: true,
        output: `Current mood: "${mood}" (color: ${color})`,
        displayOutput: `Mood: ${mood}`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error getting mood",
        output: error instanceof Error ? error.message : "Unknown error getting mood"
      };
    }
  }

  /**
   * Get available personas by calling the persona hook
   */
  async getAvailablePersonas(): Promise<ToolResult> {
    try {
      const settings = getSettingsManager();
      const hookPath = settings.getPersonaHook();
      const hookMandatory = settings.isPersonaHookMandatory();

      if (!hookPath) {
        if (hookMandatory) {
          return {
            success: false,
            error: "Persona hook is mandatory but not configured",
            output: "Persona hook is mandatory but not configured"
          };
        }
        return {
          success: false,
          error: "No persona hook configured",
          output: "No persona hook configured"
        };
      }

      const hookResult = await executeOperationHook(
        hookPath,
        "getAvailablePersonas",
        {},
        10000,
        hookMandatory,
        this.agent.getCurrentTokenCount(),
        this.agent.getMaxContextSize()
      );

      if (!hookResult.approved) {
        return {
          success: false,
          error: hookResult.reason || "Failed to get available personas",
          output: hookResult.reason || "Failed to get available personas"
        };
      }

      // Apply hook commands (ENV, TOOL_RESULT, SYSTEM)
      const results = hookResult.commands
        ? applyHookCommands(hookResult.commands)
        : { env: {}, toolResult: "", system: "" };

      // If no TOOL_RESULT was returned, the hook didn't provide personas
      if (!results.toolResult) {
        return {
          success: false,
          error: "Hook did not return available personas",
          output: "Hook did not return available personas"
        };
      }

      return {
        success: true,
        output: results.toolResult,
        displayOutput: "Available personas retrieved"
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error getting available personas",
        output: error instanceof Error ? error.message : "Unknown error getting available personas"
      };
    }
  }

}
