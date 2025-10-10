import { ToolResult } from "../types/index.js";
import { ToolDiscovery } from "./tool-discovery.js";

export class CharacterTool implements ToolDiscovery {
  private agent: any; // Reference to the GrokAgent

  setAgent(agent: any) {
    this.agent = agent;
  }

  getHandledToolNames(): string[] {
    return ["setPersona", "setMood", "getPersona", "getMood"];
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

      // Set the persona
      this.agent.setPersona(persona, color);

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

      // Set the mood
      this.agent.setMood(mood, color);

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

}
