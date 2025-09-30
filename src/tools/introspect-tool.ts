import { ToolResult } from "../types";
import { ToolDiscovery, getHandledToolNames } from "./tool-discovery";
import { getAllGrokTools } from "../grok/tools";

export class IntrospectTool implements ToolDiscovery {
  private agent: any; // Reference to the GrokAgent for accessing tool class info

  setAgent(agent: any) {
    this.agent = agent;
  }

  /**
   * Introspect available tools and system information
   */
  async introspect(target: string): Promise<ToolResult> {
    try {
      if (!target || target === "help") {
        return {
          success: true,
          output: `/introspect - Introspect available tools and environment

Usage:
  /introspect tools             - Show all available tools (internal and MCP)
  /introspect tool:TOOL_NAME    - Show schema for specific tool (e.g., tool:mcp__tavily__tavily-search)
  /introspect env               - Show ZDS_AI_AGENT_* environment variables
  /introspect context           - Show context/token usage
  /introspect all               - Show tools, environment variables, and context`,
          displayOutput: "Introspect help"
        };
      }

      // Handle tool:TOOL_NAME format for specific tool schema lookup
      if (target.startsWith("tool:")) {
        const toolName = target.substring(5); // Remove "tool:" prefix
        const allTools = await getAllGrokTools();
        const tool = allTools.find(t => t.function.name === toolName);

        if (!tool) {
          return {
            success: false,
            error: `Tool not found: ${toolName}`
          };
        }

        // Format the tool schema in a readable way
        let output = `Tool: ${tool.function.name}\n`;
        output += `Description: ${tool.function.description}\n\n`;
        output += `Parameters:\n`;

        const params = tool.function.parameters;
        if (params && params.properties) {
          const required = params.required || [];
          const properties = params.properties;

          Object.keys(properties).sort().forEach(paramName => {
            const param = properties[paramName];
            const isRequired = required.includes(paramName);
            const requiredLabel = isRequired ? " (required)" : " (optional)";

            output += `  ${paramName}${requiredLabel}\n`;
            output += `    Type: ${param.type || 'unknown'}\n`;
            if (param.description) {
              output += `    Description: ${param.description}\n`;
            }
            if (param.enum) {
              output += `    Allowed values: ${param.enum.join(', ')}\n`;
            }
            if (param.items) {
              output += `    Items: ${JSON.stringify(param.items)}\n`;
            }
            if (param.default !== undefined) {
              output += `    Default: ${param.default}\n`;
            }
          });
        } else {
          output += "  No parameters\n";
        }

        return {
          success: true,
          output,
          displayOutput: `Schema for ${toolName}`
        };
      }

      if (target === "all") {
        // Get tools
        const toolsResult = await this.introspect("tools");
        // Get env
        const envResult = await this.introspect("env");
        // Get context
        const contextResult = await this.introspect("context");

        return {
          success: true,
          output: `${toolsResult.output}\n\n=== Environment Variables ===\n${envResult.output}\n\n=== Context Usage ===\n${contextResult.output}`,
          displayOutput: "Showing all introspection data"
        };
      }

      if (target === "env") {
        const envVars = Object.entries(process.env)
          .filter(([key]) => key.startsWith("ZDS_AI_AGENT_"))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}=${value}`)
          .join("\n");

        const count = envVars ? envVars.split("\n").length : 0;
        const output = envVars || "No ZDS_AI_AGENT_* environment variables found";
        return {
          success: true,
          output,
          displayOutput: `Found ${count} ZDS_AI_AGENT_* variables`
        };
      }

      if (target === "context") {
        if (!this.agent) {
          return {
            success: false,
            error: "Agent not available for context introspection"
          };
        }

        const currentTokens = this.agent.getCurrentTokenCount();
        const maxContext = 128000;
        const usagePercent = ((currentTokens / maxContext) * 100).toFixed(2);

        const output = `Current: ${currentTokens} tokens
Maximum: ${maxContext} tokens
Usage: ${usagePercent}%`;

        return {
          success: true,
          output,
          displayOutput: `Context: ${currentTokens}/${maxContext} tokens (${usagePercent}%)`
        };
      }

      if (target === "tools") {
        const allTools = await getAllGrokTools();

        // Separate internal and MCP tools
        const internalTools = allTools.filter(tool => !tool.function.name.startsWith("mcp__"));
        const mcpTools = allTools.filter(tool => tool.function.name.startsWith("mcp__"));

        let output = "Internal Tools:\n";

        // Get tool class info from agent
        const toolClassInfo = this.agent?.getToolClassInfo() || [];

        // Create a mapping from tool names to descriptions
        const toolDescriptions = new Map<string, string>();
        internalTools.forEach(tool => {
          toolDescriptions.set(tool.function.name, tool.function.description);
        });

        // Sort classes and display their discovered methods
        const sortedClasses = toolClassInfo.sort((a: any, b: any) => a.className.localeCompare(b.className));
        sortedClasses.forEach(({ className, methods }: any) => {
          if (methods.length > 0) {
            output += `  ${className}:\n`;
            methods.sort().forEach((methodName: string) => {
              const description = toolDescriptions.get(methodName) || 'No description available';
              output += `    ${methodName} (${description})\n`;
            });
          }
        });

        // Show MCP tools grouped by server
        if (mcpTools.length > 0) {
          output += "\n";
          const toolsByServer = new Map<string, string[]>();

          mcpTools.forEach(tool => {
            // Extract server name from tool name (format: mcp__serverName__toolName)
            const parts = tool.function.name.split('__');
            if (parts.length >= 3 && parts[0] === 'mcp') {
              const serverName = parts[1];
              const toolName = parts.slice(2).join('__');

              if (!toolsByServer.has(serverName)) {
                toolsByServer.set(serverName, []);
              }
              toolsByServer.get(serverName)!.push(toolName);
            }
          });

          // Sort servers alphabetically
          const sortedServers = Array.from(toolsByServer.keys()).sort();

          sortedServers.forEach(serverName => {
            output += `MCP Tools (${serverName}):\n`;
            const tools = toolsByServer.get(serverName)!.sort();
            tools.forEach(toolName => {
              output += `  ${toolName} (mcp:${serverName})\n`;
            });
          });
        }

        if (internalTools.length === 0 && mcpTools.length === 0) {
          output += "No tools available.\n";
        }

        return {
          success: true,
          output,
          displayOutput: `Found ${internalTools.length} internal and ${mcpTools.length} MCP tools`
        };
      }

      return {
        success: false,
        error: `Unknown introspect target: ${target}. Available targets: tools, env, context, all`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Error during introspection: ${error.message}`
      };
    }
  }

  getHandledToolNames(): string[] {
    return getHandledToolNames(this);
  }
}