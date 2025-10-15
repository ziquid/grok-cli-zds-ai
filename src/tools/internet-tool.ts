import { exec } from "child_process";
import { promisify } from "util";
import { ToolResult } from "../types/index.js";
import { ToolDiscovery } from "./tool-discovery.js";

const execAsync = promisify(exec);

export class InternetTool implements ToolDiscovery {
  private agent: any; // Reference to the GrokAgent

  setAgent(agent: any) {
    this.agent = agent;
  }

  getHandledToolNames(): string[] {
    return ["downloadFile"];
  }

  /**
   * Download a file < 10MB from the Internet.
   */
  async downloadFile(url: string): Promise<ToolResult> {
    try {
      if (!this.agent) {
        return {
          success: false,
          error: "Agent not available",
          output: "Agent not available"
        };
      }

      // Get the agent's home directory and create Downloads path
      const agentHome = process.env.ZDS_AI_AGENT_HOME_DIR;
      if (!agentHome) {
        return {
          success: false,
          error: "Agent home directory not found",
          output: "Agent home directory not found"
        };
      }

      const downloadsDir = `${agentHome}/Downloads`;

      // Ensure Downloads directory exists
      try {
        await execAsync(`mkdir -p "${downloadsDir}"`);
      } catch (error) {
        return {
          success: false,
          error: `Failed to create Downloads directory: ${error}`,
          output: `Failed to create Downloads directory: ${error}`
        };
      }

      // Check file size first using curl -I (HEAD request)
      let contentLength: number;
      try {
        const { stdout } = await execAsync(`curl -sI "${url}" | grep -i "content-length" | awk '{print $2}' | tr -d '\r'`);
        contentLength = parseInt(stdout.trim() || "0");
      } catch (error) {
        return {
          success: false,
          error: `Failed to check file size: ${error}`,
          output: `Failed to check file size: ${error}`
        };
      }

      const maxSize = 10 * 1024 * 1024; // 10MB

      if (contentLength > maxSize) {
        return {
          success: false,
          error: `File too large: ${contentLength} bytes (max: ${maxSize} bytes)`,
          output: `File too large: ${contentLength} bytes (max: ${maxSize} bytes)`
        };
      }

      // Extract filename from URL
      const filename = url.split('/').pop()?.split('?')[0] || 'downloaded_file';
      const filepath = `${downloadsDir}/${filename}`;

      // Download the file
      try {
        await execAsync(`curl -L -o "${filepath}" "${url}"`);
      } catch (error) {
        return {
          success: false,
          error: `Download failed: ${error}`,
          output: `Download failed: ${error}`
        };
      }

      // Get MIME info using file command
      let fileInfo: string;
      try {
        const { stdout } = await execAsync(`file "${filepath}"`);
        fileInfo = stdout.trim() || "Unknown file type";
      } catch (error) {
        return {
          success: false,
          error: `Failed to get file info: ${error}`,
          output: `Download completed but failed to get file info: ${error}`
        };
      }

      return {
        success: true,
        output: `File downloaded successfully\nPath: ${filepath}\nSize: ${contentLength} bytes\nInfo: ${fileInfo}`,
        displayOutput: `Downloaded ${filename} (${contentLength} bytes)`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error downloading file",
        output: error instanceof Error ? error.message : "Unknown error downloading file"
      };
    }
  }
}
