import { ToolResult } from "../types";
import { ToolDiscovery, getHandledToolNames } from "./tool-discovery";

export class EnvTool implements ToolDiscovery {
  /**
   * Get all environment variables
   */
  async getAllEnv(): Promise<ToolResult> {
    try {
      const envVars = process.env;
      const envList = Object.entries(envVars)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value || ''}`)
        .join('\n');

      const count = Object.keys(envVars).length;

      return {
        success: true,
        output: `Environment Variables (${count} total):\n${envList}`,
        displayOutput: `Retrieved ${count} environment variables`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Error reading environment variables: ${error.message}`
      };
    }
  }

  /**
   * Get a specific environment variable by name
   */
  async getEnv(varName: string): Promise<ToolResult> {
    try {
      const value = process.env[varName];

      if (value === undefined) {
        return {
          success: false,
          error: `Environment variable '${varName}' not found`
        };
      }

      return {
        success: true,
        output: `${varName}=${value}`,
        displayOutput: `Retrieved environment variable: ${varName}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Error reading environment variable '${varName}': ${error.message}`
      };
    }
  }

  /**
   * Search environment variables by pattern (case-insensitive)
   */
  async searchEnv(pattern: string): Promise<ToolResult> {
    try {
      const envVars = process.env;
      const regex = new RegExp(pattern, 'i');

      const matches = Object.entries(envVars)
        .filter(([key, value]) => regex.test(key) || regex.test(value || ''))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value || ''}`)
        .join('\n');

      const matchCount = matches.split('\n').filter(line => line.length > 0).length;

      if (matchCount === 0) {
        return {
          success: true,
          output: `No environment variables match pattern: ${pattern}`,
          displayOutput: `No matches found for pattern: ${pattern}`
        };
      }

      return {
        success: true,
        output: `Environment Variables matching '${pattern}' (${matchCount} found):\n${matches}`,
        displayOutput: `Found ${matchCount} environment variables matching: ${pattern}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Error searching environment variables: ${error.message}`
      };
    }
  }

  getHandledToolNames(): string[] {
    return getHandledToolNames(this);
  }
}