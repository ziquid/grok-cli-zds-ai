import { ToolResult } from "../types/index.js";
import { ToolDiscovery } from "./tool-discovery.js";

export class TaskTool implements ToolDiscovery {
  private agent: any; // Reference to the LLMAgent

  setAgent(agent: any) {
    this.agent = agent;
  }

  getHandledToolNames(): string[] {
    return ["startActiveTask", "transitionActiveTaskStatus", "stopActiveTask"];
  }

  /**
   * Start a new active task with action and optional color
   */
  async startActiveTask(activeTask: string, action: string, color?: string): Promise<ToolResult> {
    try {
      if (!this.agent) {
        return {
          success: false,
          error: "Agent not available",
          output: "Agent not available"
        };
      }

      // Start the active task
      const result = await this.agent.startActiveTask(activeTask, action, color);

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          output: result.error || "Failed to start active task"
        };
      }

      return {
        success: true,
        output: `Active task started: ${action}: ${activeTask}${color ? ` (color: ${color})` : ''}`,
        displayOutput: `Active task started`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error starting active task",
        output: error instanceof Error ? error.message : "Unknown error starting active task"
      };
    }
  }

  /**
   * Transition the current active task to a new status/action
   */
  async transitionActiveTaskStatus(action: string, color?: string): Promise<ToolResult> {
    try {
      if (!this.agent) {
        return {
          success: false,
          error: "Agent not available",
          output: "Agent not available"
        };
      }

      // Transition the active task status
      const result = await this.agent.transitionActiveTaskStatus(action, color);

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          output: result.error || "Failed to transition active task status"
        };
      }

      return {
        success: true,
        output: `Active task status transitioned to: ${action}${color ? ` (color: ${color})` : ''}`,
        displayOutput: `Active task status updated`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error transitioning active task status",
        output: error instanceof Error ? error.message : "Unknown error transitioning active task status"
      };
    }
  }

  /**
   * Stop the current active task with reason and documentation file
   */
  async stopActiveTask(reason: string, documentationFile: string, color?: string): Promise<ToolResult> {
    try {
      if (!this.agent) {
        return {
          success: false,
          error: "Agent not available",
          output: "Agent not available"
        };
      }

      // Stop the active task
      const result = await this.agent.stopActiveTask(reason, documentationFile, color);

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          output: result.error || "Failed to stop active task"
        };
      }

      return {
        success: true,
        output: `Active task stopped: ${reason}${color ? ` (color: ${color})` : ''}`,
        displayOutput: `Active task stopped`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error stopping active task",
        output: error instanceof Error ? error.message : "Unknown error stopping active task"
      };
    }
  }
}