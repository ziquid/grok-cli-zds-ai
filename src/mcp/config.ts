import { getSettingsManager } from "../utils/settings-manager.js";
import { MCPServerConfig } from "./client.js";

export interface MCPConfig {
  servers: MCPServerConfig[];
}

/**
 * Substitute environment variables in a string
 * Supports ${VAR_NAME} syntax
 */
function substituteEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      console.warn(`Warning: Environment variable ${varName} is not defined, leaving as ${match}`);
      return match;
    }
    return envValue;
  });
}

/**
 * Recursively substitute environment variables in configuration objects
 */
function substituteEnvVarsInConfig(obj: any): any {
  if (typeof obj === 'string') {
    return substituteEnvVars(obj);
  } else if (Array.isArray(obj)) {
    return obj.map(item => substituteEnvVarsInConfig(item));
  } else if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVarsInConfig(value);
    }
    return result;
  }
  return obj;
}

/**
 * Load MCP configuration from user settings (with project settings override)
 * Applies environment variable substitution to all string values
 */
export function loadMCPConfig(): MCPConfig {
  const manager = getSettingsManager();
  const userSettings = manager.loadUserSettings();
  const projectSettings = manager.loadProjectSettings();

  // Use project settings if available, otherwise fall back to user settings
  const mcpServers = projectSettings.mcpServers || userSettings.mcpServers;
  const servers = mcpServers
    ? Object.entries(mcpServers)
        .filter(([_, config]: [string, any]) => config.disabled !== true) // Filter out disabled servers
        .map(([name, config]: [string, any]) => {
          // Apply environment variable substitution to the entire config
          const substitutedConfig = substituteEnvVarsInConfig(config);

          return {
            name, // Ensure name field is set from the object key
            transport: substitutedConfig.transport,
            command: substitutedConfig.command,
            args: substitutedConfig.args,
            env: substitutedConfig.env,
          };
        })
    : [];
  return { servers };
}

export function saveMCPConfig(config: MCPConfig): void {
  const manager = getSettingsManager();
  const mcpServers: Record<string, MCPServerConfig> = {};

  // Convert servers array to object keyed by name
  for (const server of config.servers) {
    mcpServers[server.name] = server;
  }

  manager.updateProjectSetting('mcpServers', mcpServers);
}

export function addMCPServer(config: MCPServerConfig): void {
  const manager = getSettingsManager();
  const projectSettings = manager.loadProjectSettings();
  const mcpServers = projectSettings.mcpServers || {};

  mcpServers[config.name] = config;
  manager.updateProjectSetting('mcpServers', mcpServers);
}

export function removeMCPServer(serverName: string): void {
  const manager = getSettingsManager();
  const projectSettings = manager.loadProjectSettings();
  const mcpServers = projectSettings.mcpServers;

  if (mcpServers) {
    delete mcpServers[serverName];
    manager.updateProjectSetting('mcpServers', mcpServers);
  }
}

export function getMCPServer(serverName: string): MCPServerConfig | undefined {
  const manager = getSettingsManager();
  const projectSettings = manager.loadProjectSettings();
  return projectSettings.mcpServers?.[serverName];
}

// Predefined server configurations
export const PREDEFINED_SERVERS: Record<string, MCPServerConfig> = {};
