import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolResult } from '../types';

const execAsync = promisify(exec);

export class BashTool {
  private currentDirectory: string = process.cwd();


  async execute(command: string, timeout: number = 30000): Promise<ToolResult> {
    try {
      if (command.startsWith('cd ')) {
        const newDir = command.substring(3).trim();
        try {
          process.chdir(newDir);
          this.currentDirectory = process.cwd();
          return {
            success: true,
            output: `Changed directory to: ${this.currentDirectory}`
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Cannot change directory: ${error.message}`
          };
        }
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd: this.currentDirectory,
        timeout,
        maxBuffer: 1024 * 1024
      });

      const output = stdout + (stderr ? `\nSTDERR: ${stderr}` : '');
      
      return {
        success: true,
        output: output.trim() || 'Command executed successfully (no output)'
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Command failed: ${error.message}`
      };
    }
  }

  getCurrentDirectory(): string {
    return this.currentDirectory;
  }

  async listFiles(directory: string = '.'): Promise<ToolResult> {
    return this.execute(`ls -la ${directory}`);
  }

  async findFiles(pattern: string, directory: string = '.'): Promise<ToolResult> {
    return this.execute(`find ${directory} -name "${pattern}" -type f`);
  }

  async grep(pattern: string, files: string = '.'): Promise<ToolResult> {
    return this.execute(`grep -r "${pattern}" ${files}`);
  }
}