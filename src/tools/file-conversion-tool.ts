import { exec } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { ToolResult } from "../types/index.js";
import { ToolDiscovery, getHandledToolNames } from "./tool-discovery.js";

const execAsync = promisify(exec);

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to bundled read_xlsx.py script (relative to dist/tools/)
const READ_XLSX_SCRIPT = join(__dirname, "../bin/read_xlsx.py");

export class FileConversionTool implements ToolDiscovery {
  private agent: any; // Reference to the GrokAgent

  setAgent(agent: any) {
    this.agent = agent;
  }

  getHandledToolNames(): string[] {
    return getHandledToolNames(this);
  }

  /**
   * Read an XLSX file and return its contents.
   * Uses read_xlsx.py script with multiple output format options.
   */
  async readXlsx(
    filename: string,
    sheetName?: string,
    outputFormat?: "text" | "json" | "all-sheets-json" | "csv",
    output?: string
  ): Promise<ToolResult> {
    try {
      if (!filename) {
        return {
          success: false,
          error: "Filename is required",
          output: "Filename is required"
        };
      }

      // Escape filename for shell
      const escapedFilename = filename.replace(/'/g, "'\\''");

      // Build command using bundled read_xlsx.py script
      let command = `'${READ_XLSX_SCRIPT}' '${escapedFilename}'`;

      // Add sheet name if provided
      if (sheetName) {
        const escapedSheetName = sheetName.replace(/'/g, "'\\''");
        command += ` --sheet '${escapedSheetName}'`;
      }

      // Add output format options
      const format = outputFormat || "text";
      switch (format) {
        case "json":
          command += " --json";
          break;
        case "all-sheets-json":
          command += " --all-sheets-json";
          break;
        case "csv":
          command += " --csv";
          break;
        case "text":
        default:
          // No additional flags for text format
          break;
      }

      // Add output file if specified
      if (output) {
        const escapedOutput = output.replace(/'/g, "'\\''");
        command += ` --output '${escapedOutput}'`;
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: 60000, // 60 second timeout
          shell: '/bin/zsh'
        });

        // If there's stderr output and no stdout, it's an error
        if (stderr && !stdout) {
          return {
            success: false,
            error: `XLSX reading failed: ${stderr}`,
            output: stderr
          };
        }

        const result = stdout.trim();

        // Create display output based on format
        let displayOutput: string;
        if (format === "json" || format === "all-sheets-json") {
          try {
            const jsonData = JSON.parse(result);
            if (format === "all-sheets-json") {
              const sheetCount = Object.keys(jsonData.sheets || {}).length;
              displayOutput = `Read ${sheetCount} sheet(s) from ${filename}`;
            } else {
              displayOutput = `Read ${jsonData.row_count || 0} row(s) from ${sheetName || jsonData.sheet_name || filename}`;
            }
          } catch {
            displayOutput = `Read XLSX file: ${filename}`;
          }
        } else if (format === "csv") {
          displayOutput = `Converted ${sheetName || 'default sheet'} to CSV`;
        } else {
          displayOutput = `Read XLSX file: ${filename}${sheetName ? ` (sheet: ${sheetName})` : ''}`;
        }

        // If output file was specified, mention it in display
        if (output) {
          displayOutput += ` → ${output}`;
        }

        return {
          success: true,
          output: result,
          displayOutput: displayOutput
        };
      } catch (error: any) {
        // Extract error details
        const errorMessage = error.message || "Unknown error";
        const stderr = error.stderr || "";
        const stdout = error.stdout || "";

        return {
          success: false,
          error: `XLSX reading failed (code ${error.code || 'unknown'}): ${errorMessage}${stderr ? '\nstderr: ' + stderr : ''}${stdout ? '\nstdout: ' + stdout : ''}`,
          output: `Error code: ${error.code || 'unknown'}\n${errorMessage}${stderr ? '\nstderr: ' + stderr : ''}${stdout ? '\nstdout: ' + stdout : ''}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error reading XLSX file",
        output: error instanceof Error ? error.message : "Unknown error reading XLSX file"
      };
    }
  }

  /**
   * List all available sheets in an XLSX file.
   */
  async listXlsxSheets(filename: string): Promise<ToolResult> {
    try {
      if (!filename) {
        return {
          success: false,
          error: "Filename is required",
          output: "Filename is required"
        };
      }

      // Escape filename for shell
      const escapedFilename = filename.replace(/'/g, "'\\''");

      // Build command to list sheets using bundled script
      const command = `'${READ_XLSX_SCRIPT}' '${escapedFilename}' --list-sheets`;

      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: 30000, // 30 second timeout
          shell: '/bin/zsh'
        });

        // If there's stderr output and no stdout, it's an error
        if (stderr && !stdout) {
          return {
            success: false,
            error: `XLSX sheet listing failed: ${stderr}`,
            output: stderr
          };
        }

        const output = stdout.trim();

        return {
          success: true,
          output: output,
          displayOutput: `Listed sheets in ${filename}`
        };
      } catch (error: any) {
        // Extract error details
        const errorMessage = error.message || "Unknown error";
        const stderr = error.stderr || "";
        const stdout = error.stdout || "";

        return {
          success: false,
          error: `XLSX sheet listing failed (code ${error.code || 'unknown'}): ${errorMessage}${stderr ? '\nstderr: ' + stderr : ''}${stdout ? '\nstdout: ' + stdout : ''}`,
          output: `Error code: ${error.code || 'unknown'}\n${errorMessage}${stderr ? '\nstderr: ' + stderr : ''}${stdout ? '\nstdout: ' + stdout : ''}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error listing XLSX sheets",
        output: error instanceof Error ? error.message : "Unknown error listing XLSX sheets"
      };
    }
  }
}
