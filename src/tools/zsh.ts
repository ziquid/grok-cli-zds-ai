import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolResult } from '../types';
import { ConfirmationService } from '../utils/confirmation-service';
import { expandHomeDir } from '../utils/path-utils';
import { ToolDiscovery, getHandledToolNames } from './tool-discovery';

const execAsync = promisify(exec);

export class ZshTool implements ToolDiscovery {
  private confirmationService = ConfirmationService.getInstance();


  async execute(command: string, timeout: number = 30000, skipConfirmation: boolean = false): Promise<ToolResult> {
    try {
      // Check if user has already accepted zsh commands for this session
      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!skipConfirmation && !sessionFlags.zshCommands && !sessionFlags.allOperations) {
        // Request confirmation showing the command
        const confirmationResult = await this.confirmationService.requestConfirmation({
          operation: 'Run zsh command',
          filename: command,
          showVSCodeOpen: false,
          content: `Command: ${command}\nWorking directory: ${process.cwd()}`
        }, 'zsh');

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error: confirmationResult.feedback || 'Command execution cancelled by user'
          };
        }
      }

      if (command.startsWith('cd ')) {
        const newDirRaw = command.substring(3).trim();
        const newDir = expandHomeDir(newDirRaw);
        try {
          process.chdir(newDir);
          return {
            success: true,
            output: `Changed directory to: ${process.cwd()}`
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Cannot change directory: ${error.message}`
          };
        }
      }

      const { stdout, stderr } = await execAsync(command, {
        timeout,
        maxBuffer: 1024 * 1024,
        shell: 'zsh'
      });

      const output = stdout + (stderr ? `\nSTDERR: ${stderr}` : '');

      return {
        success: true,
        output: output.trim() || 'Command executed successfully (no output)'
      };
    } catch (error: any) {
      // Capture stdout and stderr even from failed commands
      let errorOutput = `Command failed: ${error.message}`;

      if (error.stdout || error.stderr) {
        errorOutput += '\n\n';
        if (error.stdout) {
          errorOutput += `STDOUT:\n${error.stdout}`;
        }
        if (error.stderr) {
          errorOutput += `${error.stdout ? '\n\n' : ''}STDERR:\n${error.stderr}`;
        }
      }

      return {
        success: false,
        error: errorOutput
      };
    }
  }

  getCurrentDirectory(): string {
    return process.cwd();
  }

  async listFiles(directory: string = '.'): Promise<ToolResult> {
    return this.execute(`ls -la ${directory}`);
  }


  async chdir(path: string): Promise<ToolResult> {
    try {
      const resolvedPath = expandHomeDir(path);
      process.chdir(resolvedPath);
      return {
        success: true,
        output: `Changed directory to: ${process.cwd()}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Cannot change directory: ${error.message}`
      };
    }
  }

  async pwdir(): Promise<ToolResult> {
    return {
      success: true,
      output: process.cwd()
    };
  }

  getHandledToolNames(): string[] {
    return getHandledToolNames(this);
  }
}

