import { exec } from "child_process";
import { promisify } from "util";
import { EventEmitter } from "events";

const execAsync = promisify(exec);

export interface ConfirmationOptions {
  operation: string;
  filename: string;
  showVSCodeOpen?: boolean;
  content?: string; // Content to show in confirmation dialog
}

export interface ConfirmationResult {
  confirmed: boolean;
  dontAskAgain?: boolean;
  feedback?: string;
}

export class ConfirmationService extends EventEmitter {
  private static instance: ConfirmationService;
  private skipConfirmationThisSession = false;
  private pendingConfirmation: Promise<ConfirmationResult> | null = null;
  private resolveConfirmation: ((result: ConfirmationResult) => void) | null =
    null;

  // Session flags for different operation types
  private sessionFlags = {
    fileOperations: false,
    zshCommands: false,
    allOperations: false,
  };

  // List of specific commands to auto-approve
  private approvedCommands = new Set<string>();

  static getInstance(): ConfirmationService {
    if (!ConfirmationService.instance) {
      ConfirmationService.instance = new ConfirmationService();
    }
    return ConfirmationService.instance;
  }

  constructor() {
    super();
  }

  async requestConfirmation(
    options: ConfirmationOptions,
    operationType: "file" | "zsh" = "file"
  ): Promise<ConfirmationResult> {
    // Check session flags
    if (
      this.sessionFlags.allOperations ||
      (operationType === "file" && this.sessionFlags.fileOperations) ||
      (operationType === "zsh" && this.sessionFlags.zshCommands)
    ) {
      return { confirmed: true };
    }

    // Check if this specific command is approved
    if (this.isCommandApproved(options.operation, options.filename)) {
      return { confirmed: true };
    }

    // If VS Code should be opened, try to open it
    if (options.showVSCodeOpen) {
      try {
        await this.openInVSCode(options.filename);
      } catch (error) {
        // If VS Code opening fails, continue without it
        options.showVSCodeOpen = false;
      }
    }

    // Create a promise that will be resolved by the UI component
    this.pendingConfirmation = new Promise<ConfirmationResult>((resolve) => {
      this.resolveConfirmation = resolve;
    });

    // Emit custom event that the UI can listen to (using setImmediate to ensure the UI updates)
    setImmediate(() => {
      this.emit("confirmation-requested", options);
    });

    const result = await this.pendingConfirmation;

    if (result.dontAskAgain) {
      // Set the appropriate session flag based on operation type
      if (operationType === "file") {
        this.sessionFlags.fileOperations = true;
      } else if (operationType === "zsh") {
        this.sessionFlags.zshCommands = true;
      }
      // Could also set allOperations for global skip
    }

    return result;
  }

  confirmOperation(confirmed: boolean, dontAskAgain?: boolean): void {
    if (this.resolveConfirmation) {
      this.resolveConfirmation({ confirmed, dontAskAgain });
      this.resolveConfirmation = null;
      this.pendingConfirmation = null;
    }
  }

  rejectOperation(feedback?: string): void {
    if (this.resolveConfirmation) {
      this.resolveConfirmation({ confirmed: false, feedback });
      this.resolveConfirmation = null;
      this.pendingConfirmation = null;
    }
  }

  private async openInVSCode(filename: string): Promise<void> {
    // Try different VS Code commands
    const commands = ["code", "code-insiders", "codium"];

    for (const cmd of commands) {
      try {
        await execAsync(`which ${cmd}`);
        await execAsync(`${cmd} "${filename}"`);
        return;
      } catch (error) {
        // Continue to next command
        continue;
      }
    }

    throw new Error("VS Code not found");
  }

  isPending(): boolean {
    return this.pendingConfirmation !== null;
  }

  resetSession(): void {
    this.sessionFlags = {
      fileOperations: false,
      zshCommands: false,
      allOperations: false,
    };
    this.approvedCommands.clear();
  }

  getSessionFlags() {
    return { ...this.sessionFlags };
  }

  setSessionFlag(
    flagType: "fileOperations" | "zshCommands" | "allOperations",
    value: boolean
  ) {
    this.sessionFlags[flagType] = value;
  }

  /**
   * Set specific commands to auto-approve
   */
  setApprovedCommands(commands: string[]): void {
    this.approvedCommands.clear();
    commands.forEach(cmd => this.approvedCommands.add(cmd.toLowerCase()));
  }

  /**
   * Check if a command should be auto-approved
   */
  private isCommandApproved(operation: string, filename: string): boolean {
    // Check for exact operation matches
    if (this.approvedCommands.has(operation.toLowerCase())) {
      return true;
    }

    // Check for common command mappings
    const normalizedOp = this.normalizeOperation(operation, filename);
    return this.approvedCommands.has(normalizedOp);
  }

  /**
   * Normalize operation names to match common command names
   */
  private normalizeOperation(operation: string, filename: string): string {
    const op = operation.toLowerCase();

    // Map common operations to their command names
    if (op.includes('run zsh command') || op.includes('execute')) {
      // Extract actual command from filename for zsh operations
      const cmd = filename.split(' ')[0]; // Get first word as command
      return cmd.toLowerCase();
    }

    // Direct tool mappings
    if (op.includes('edit file')) return 'str_replace_editor';
    if (op.includes('write')) return 'create_file';
    if (op.includes('view') || op.includes('read')) return 'view_file';

    // Handle specific commands that users might want to approve
    if (filename.startsWith('ls ')) return 'list_files';
    if (filename.startsWith('pwd')) return 'pwd';

    return op;
  }
}
