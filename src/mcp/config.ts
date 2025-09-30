import { getSettingsManager } from "../utils/settings-manager";
import { MCPServerConfig } from "./client";

export interface MCPConfig {
  servers: MCPServerConfig[];
}

/**
 * Load MCP configuration from user settings (with project settings override)
 */
export function loadMCPConfig(): MCPConfig {
  const manager = getSettingsManager();
  const userSettings = manager.loadUserSettings();
  const projectSettings = manager.loadProjectSettings();

  // Use project settings if available, otherwise fall back to user settings
  const mcpServers = projectSettings.mcpServers || userSettings.mcpServers;
  const servers = mcpServers ? Object.values(mcpServers) : [];
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
