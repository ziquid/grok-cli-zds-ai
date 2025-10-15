import fs from "fs-extra";
import * as path from "path";
import { ToolResult, EditorCommand } from "../types/index.js";
import { ConfirmationService } from "../utils/confirmation-service.js";
import { expandHomeDir } from "../utils/path-utils.js";
import { ToolDiscovery, getHandledToolNames } from "./tool-discovery.js";

export class TextEditorTool implements ToolDiscovery {
  private editHistory: EditorCommand[] = [];
  private confirmationService = ConfirmationService.getInstance();
  private agent: any; // Reference to GrokAgent for context awareness

  setAgent(agent: any) {
    this.agent = agent;
  }

  /**
   * Get the maximum characters allowed based on current context usage
   * Returns null if viewFile should be disabled
   */
  private getMaxCharsAllowed(): number | null {
    if (!this.agent) {
      return 80000; // Default: ~20k tokens if no agent
    }

    const contextPercent = this.agent.getContextUsagePercent();

    // Disable viewFile at 95%+
    if (contextPercent >= 95) {
      return null;
    }

    // 2k tokens max at 90%+
    if (contextPercent >= 90) {
      return 8000; // ~2k tokens
    }

    // 10k tokens max at 80%+
    if (contextPercent >= 80) {
      return 40000; // ~10k tokens
    }

    // 20k tokens max normally
    return 80000; // ~20k tokens
  }

  async viewFile(
    filePath: string,
    viewRange?: [number, number]
  ): Promise<ToolResult> {
    try {
      // Check if viewFile is disabled due to high context usage
      const maxChars = this.getMaxCharsAllowed();
      if (maxChars === null) {
        const contextPercent = this.agent?.getContextUsagePercent() || 0;
        return {
          success: false,
          error: `viewFile is disabled at ${Math.round(contextPercent)}% context usage. Please save notes and clear cache first.`,
          output: `viewFile is disabled at ${Math.round(contextPercent)}% context usage. Please save notes and clear cache first.`
        };
      }

      const expandedPath = expandHomeDir(filePath);
      const resolvedPath = path.resolve(expandedPath);

      if (await fs.pathExists(resolvedPath)) {
        const stats = await fs.stat(resolvedPath);

        if (stats.isDirectory()) {
          const files = await fs.readdir(resolvedPath);
          return {
            success: true,
            output: `Directory contents of ${filePath}:\n${files.join("\n")}`,
            displayOutput: `Listed directory ${filePath} (${files.length} items)`,
          };
        }

        const content = await fs.readFile(resolvedPath, "utf-8");
        const lines = content.split("\n");

        if (viewRange) {
          const [start, end] = viewRange;
          const selectedLines = lines.slice(start - 1, end);
          let numberedLines = selectedLines
            .map((line, idx) => `${start + idx}: ${line}`)
            .join("\n");

          // Apply character limit even to ranges
          if (numberedLines.length > maxChars) {
            numberedLines = numberedLines.substring(0, maxChars);
            const contextPercent = this.agent?.getContextUsagePercent() || 0;
            return {
              success: true,
              output: `Lines ${start}-${end} of ${filePath} (truncated due to ${Math.round(contextPercent)}% context usage):\n${numberedLines}\n\n[Content truncated to ~${Math.round(maxChars / 4000)}k tokens. Use smaller ranges.]`,
              displayOutput: `Read ${filePath} (lines ${start}-${end}, truncated)`,
            };
          }

          return {
            success: true,
            output: `Lines ${start}-${end} of ${filePath}:\n${numberedLines}`,
            displayOutput: `Read ${filePath} (lines ${start}-${end})`,
          };
        }

        // Full file view - apply limits
        const totalLines = lines.length;
        let numberedLines = lines
          .map((line, idx) => `${idx + 1}: ${line}`)
          .join("\n");

        let truncated = false;
        if (numberedLines.length > maxChars) {
          numberedLines = numberedLines.substring(0, maxChars);
          truncated = true;
        }

        const contextPercent = this.agent?.getContextUsagePercent() || 0;
        const truncationMessage = truncated
          ? `\n\n[Content truncated to ~${Math.round(maxChars / 4000)}k tokens due to ${Math.round(contextPercent)}% context usage. Use viewFile with viewRange parameter for specific sections.]`
          : "";

        return {
          success: true,
          output: `Contents of ${filePath}:\n${numberedLines}${truncationMessage}`,
          displayOutput: truncated
            ? `Read ${filePath} (${totalLines} lines, truncated due to context limits)`
            : `Read ${filePath} (${totalLines} lines)`,
        };
      } else {
        return {
          success: false,
          error: `File or directory not found: ${filePath}`,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Error viewing ${filePath}: ${error.message}`,
      };
    }
  }

  async strReplace(
    filePath: string,
    oldStr: string,
    newStr: string,
    replaceAll: boolean = false
  ): Promise<ToolResult> {
    try {
      const expandedPath = expandHomeDir(filePath);
      const resolvedPath = path.resolve(expandedPath);

      if (!(await fs.pathExists(resolvedPath))) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      const content = await fs.readFile(resolvedPath, "utf-8");

      if (!content.includes(oldStr)) {
        if (oldStr.includes('\n')) {
          const fuzzyResult = this.findFuzzyMatch(content, oldStr);
          if (fuzzyResult) {
            oldStr = fuzzyResult;
          } else {
            return {
              success: false,
              error: `String not found in file. For multi-line replacements, consider using line-based editing.`,
            };
          }
        } else {
          return {
            success: false,
            error: `String not found in file: "${oldStr}"`,
          };
        }
      }

      const occurrences = (content.match(new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      
      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!sessionFlags.fileOperations && !sessionFlags.allOperations) {
        const previewContent = replaceAll 
          ? content.split(oldStr).join(newStr)
          : content.replace(oldStr, newStr);
        const oldLines = content.split("\n");
        const newLines = previewContent.split("\n");
        const diffContent = this.generateDiff(oldLines, newLines, filePath);

        const confirmationResult =
          await this.confirmationService.requestConfirmation(
            {
              operation: `Edit file${replaceAll && occurrences > 1 ? ` (${occurrences} occurrences)` : ''}`,
              filename: filePath,
              showVSCodeOpen: false,
              content: diffContent,
            },
            "file"
          );

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error: confirmationResult.feedback
              ? `File edit canceled by user: ${confirmationResult.feedback}`
              : "File edit canceled by user",
          };
        }
      }

      const newContent = replaceAll
        ? content.split(oldStr).join(newStr)
        : content.replace(oldStr, newStr);
      await fs.writeFile(resolvedPath, newContent, "utf-8");

      this.editHistory.push({
        command: "str_replace",
        path: filePath,
        old_str: oldStr,
        new_str: newStr,
      });

      const oldLines = content.split("\n");
      const newLines = newContent.split("\n");
      const diff = this.generateDiff(oldLines, newLines, filePath);

      // Extract filename from path for display
      const filename = path.basename(filePath);
      const changeCount = replaceAll && occurrences > 1 ? occurrences : 1;

      return {
        success: true,
        output: diff,
        displayOutput: `Updated ${filename} (${changeCount} ${changeCount === 1 ? 'change' : 'changes'})`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Error replacing text in ${filePath}: ${error.message}`,
      };
    }
  }

  async createNewFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      // Validate required parameters
      if (content === undefined || content === null) {
        return {
          success: false,
          error: "Content parameter is required for createNewFile",
        };
      }

      const expandedPath = expandHomeDir(filePath);
      const resolvedPath = path.resolve(expandedPath);

      // Check if user has already accepted file operations for this session
      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!sessionFlags.fileOperations && !sessionFlags.allOperations) {
        // Create a diff-style preview for file creation
        const contentLines = content.split("\n");
        const diffContent = [
          `Created ${filePath}`,
          `--- /dev/null`,
          `+++ b/${filePath}`,
          `@@ -0,0 +1,${contentLines.length} @@`,
          ...contentLines.map((line) => `+${line}`),
        ].join("\n");

        const confirmationResult =
          await this.confirmationService.requestConfirmation(
            {
              operation: "Write",
              filename: filePath,
              showVSCodeOpen: false,
              content: diffContent,
            },
            "file"
          );

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error: confirmationResult.feedback
              ? `File creation canceled by user: ${confirmationResult.feedback}`
              : "File creation canceled by user",
          };
        }
      }

      const dir = path.dirname(resolvedPath);
      await fs.ensureDir(dir);
      await fs.writeFile(resolvedPath, content, "utf-8");

      this.editHistory.push({
        command: "create",
        path: filePath,
        content,
      });

      // Generate diff output using the same method as str_replace
      const oldLines: string[] = []; // Empty for new files
      const newLines = content.split("\n");
      const diff = this.generateDiff(oldLines, newLines, filePath);

      // Extract filename from path for display
      const filename = path.basename(filePath);
      const lineCount = newLines.length;

      return {
        success: true,
        output: diff,
        displayOutput: `Created ${filename} (${lineCount} ${lineCount === 1 ? 'line' : 'lines'})`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Error creating ${filePath}: ${error.message}`,
      };
    }
  }

  async replaceLines(
    filePath: string,
    startLine: number,
    endLine: number,
    newContent: string
  ): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(filePath);

      if (!(await fs.pathExists(resolvedPath))) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      const fileContent = await fs.readFile(resolvedPath, "utf-8");
      const lines = fileContent.split("\n");
      
      if (startLine < 1 || startLine > lines.length) {
        return {
          success: false,
          error: `Invalid start line: ${startLine}. File has ${lines.length} lines.`,
        };
      }
      
      if (endLine < startLine || endLine > lines.length) {
        return {
          success: false,
          error: `Invalid end line: ${endLine}. Must be between ${startLine} and ${lines.length}.`,
        };
      }

      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!sessionFlags.fileOperations && !sessionFlags.allOperations) {
        const newLines = [...lines];
        const replacementLines = newContent.split("\n");
        newLines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
        
        const diffContent = this.generateDiff(lines, newLines, filePath);

        const confirmationResult =
          await this.confirmationService.requestConfirmation(
            {
              operation: `Replace lines ${startLine}-${endLine}`,
              filename: filePath,
              showVSCodeOpen: false,
              content: diffContent,
            },
            "file"
          );

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error: confirmationResult.feedback
              ? `Line replacement canceled by user: ${confirmationResult.feedback}`
              : "Line replacement canceled by user",
          };
        }
      }

      const replacementLines = newContent.split("\n");
      lines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
      const newFileContent = lines.join("\n");

      await fs.writeFile(resolvedPath, newFileContent, "utf-8");

      this.editHistory.push({
        command: "str_replace",
        path: filePath,
        old_str: `lines ${startLine}-${endLine}`,
        new_str: newContent,
      });

      const oldLines = fileContent.split("\n");
      const diff = this.generateDiff(oldLines, lines, filePath);

      // Extract filename from path for display
      const filename = path.basename(filePath);
      const lineRange = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`;

      return {
        success: true,
        output: diff,
        displayOutput: `Replaced ${lineRange} in ${filename}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Error replacing lines in ${filePath}: ${error.message}`,
      };
    }
  }

  async insertLines(
    filePath: string,
    insertLine: number,
    content: string
  ): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(filePath);

      if (!(await fs.pathExists(resolvedPath))) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      const fileContent = await fs.readFile(resolvedPath, "utf-8");
      const lines = fileContent.split("\n");

      lines.splice(insertLine - 1, 0, content);
      const newContent = lines.join("\n");

      await fs.writeFile(resolvedPath, newContent, "utf-8");

      this.editHistory.push({
        command: "insert",
        path: filePath,
        insert_line: insertLine,
        content,
      });

      const filename = path.basename(filePath);

      return {
        success: true,
        output: `Successfully inserted content at line ${insertLine} in ${filePath}`,
        displayOutput: `Inserted at line ${insertLine} in ${filename}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Error inserting content in ${filePath}: ${error.message}`,
      };
    }
  }

  async undoEdit(): Promise<ToolResult> {
    if (this.editHistory.length === 0) {
      return {
        success: false,
        error: "No edits to undo",
      };
    }

    const lastEdit = this.editHistory.pop()!;

    try {
      switch (lastEdit.command) {
        case "str_replace":
          if (lastEdit.path && lastEdit.old_str && lastEdit.new_str) {
            const content = await fs.readFile(lastEdit.path, "utf-8");
            const revertedContent = content.replace(
              lastEdit.new_str,
              lastEdit.old_str
            );
            await fs.writeFile(lastEdit.path, revertedContent, "utf-8");
          }
          break;

        case "create":
          if (lastEdit.path) {
            await fs.remove(lastEdit.path);
          }
          break;

        case "insert":
          if (lastEdit.path && lastEdit.insert_line) {
            const content = await fs.readFile(lastEdit.path, "utf-8");
            const lines = content.split("\n");
            lines.splice(lastEdit.insert_line - 1, 1);
            await fs.writeFile(lastEdit.path, lines.join("\n"), "utf-8");
          }
          break;
      }

      return {
        success: true,
        output: `Successfully undid ${lastEdit.command} operation`,
        displayOutput: `Undid ${lastEdit.command} operation`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Error undoing edit: ${error.message}`,
      };
    }
  }

  private findFuzzyMatch(content: string, searchStr: string): string | null {
    const functionMatch = searchStr.match(/function\s+(\w+)/);
    if (!functionMatch) return null;
    
    const functionName = functionMatch[1];
    const contentLines = content.split('\n');
    
    let functionStart = -1;
    for (let i = 0; i < contentLines.length; i++) {
      if (contentLines[i].includes(`function ${functionName}`) && contentLines[i].includes('{')) {
        functionStart = i;
        break;
      }
    }
    
    if (functionStart === -1) return null;
    
    let braceCount = 0;
    let functionEnd = functionStart;
    
    for (let i = functionStart; i < contentLines.length; i++) {
      const line = contentLines[i];
      for (const char of line) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }
      
      if (braceCount === 0 && i > functionStart) {
        functionEnd = i;
        break;
      }
    }
    
    const actualFunction = contentLines.slice(functionStart, functionEnd + 1).join('\n');
    
    const searchNormalized = this.normalizeForComparison(searchStr);
    const actualNormalized = this.normalizeForComparison(actualFunction);
    
    if (this.isSimilarStructure(searchNormalized, actualNormalized)) {
      return actualFunction;
    }
    
    return null;
  }
  
  private normalizeForComparison(str: string): string {
    return str
      .replace(/["'`]/g, '"')
      .replace(/\s+/g, ' ')
      .replace(/{\s+/g, '{ ')
      .replace(/\s+}/g, ' }')
      .replace(/;\s*/g, ';')
      .trim();
  }
  
  private isSimilarStructure(search: string, actual: string): boolean {
    const extractTokens = (str: string) => {
      const tokens = str.match(/\b(function|console\.log|return|if|else|for|while)\b/g) || [];
      return tokens;
    };

    const searchTokens = extractTokens(search);
    const actualTokens = extractTokens(actual);

    if (searchTokens.length !== actualTokens.length) return false;

    for (let i = 0; i < searchTokens.length; i++) {
      if (searchTokens[i] !== actualTokens[i]) return false;
    }

    return true;
  }

  /**
   * Compute Longest Common Subsequence using dynamic programming
   * Returns array of indices in oldLines that are part of LCS
   */
  private computeLCS(oldLines: string[], newLines: string[]): number[][] {
    const m = oldLines.length;
    const n = newLines.length;
    const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

    // Build LCS length table
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    return dp;
  }

  /**
   * Extract changes from LCS table
   * Returns array of change regions
   */
  private extractChanges(
    oldLines: string[],
    newLines: string[],
    lcs: number[][]
  ): Array<{ oldStart: number; oldEnd: number; newStart: number; newEnd: number }> {
    const changes: Array<{
      oldStart: number;
      oldEnd: number;
      newStart: number;
      newEnd: number;
    }> = [];

    let i = oldLines.length;
    let j = newLines.length;
    let oldEnd = i;
    let newEnd = j;
    let inChange = false;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        // Lines match - if we were in a change, close it
        if (inChange) {
          changes.unshift({
            oldStart: i,
            oldEnd: oldEnd,
            newStart: j,
            newEnd: newEnd
          });
          inChange = false;
        }
        i--;
        j--;
      } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
        // Insertion in new file
        if (!inChange) {
          oldEnd = i;
          newEnd = j;
          inChange = true;
        }
        j--;
      } else if (i > 0) {
        // Deletion from old file
        if (!inChange) {
          oldEnd = i;
          newEnd = j;
          inChange = true;
        }
        i--;
      }
    }

    // Close any remaining change
    if (inChange) {
      changes.unshift({
        oldStart: 0,
        oldEnd: oldEnd,
        newStart: 0,
        newEnd: newEnd
      });
    }

    return changes;
  }

  private generateDiff(
    oldLines: string[],
    newLines: string[],
    filePath: string
  ): string {
    const CONTEXT_LINES = 3;

    // Use LCS-based diff algorithm to find actual changes
    const lcs = this.computeLCS(oldLines, newLines);
    const changes = this.extractChanges(oldLines, newLines, lcs);
    
    const hunks: Array<{
      oldStart: number;
      oldCount: number;
      newStart: number;
      newCount: number;
      lines: Array<{ type: '+' | '-' | ' '; content: string }>;
    }> = [];
    
    let accumulatedOffset = 0;
    
    for (let changeIdx = 0; changeIdx < changes.length; changeIdx++) {
      const change = changes[changeIdx];
      
      let contextStart = Math.max(0, change.oldStart - CONTEXT_LINES);
      let contextEnd = Math.min(oldLines.length, change.oldEnd + CONTEXT_LINES);
      
      if (hunks.length > 0) {
        const lastHunk = hunks[hunks.length - 1];
        const lastHunkEnd = lastHunk.oldStart + lastHunk.oldCount;
        
        if (lastHunkEnd >= contextStart) {
          const oldHunkEnd = lastHunk.oldStart + lastHunk.oldCount;
          const newContextEnd = Math.min(oldLines.length, change.oldEnd + CONTEXT_LINES);
          
          for (let idx = oldHunkEnd; idx < change.oldStart; idx++) {
            lastHunk.lines.push({ type: ' ', content: oldLines[idx] });
          }
          
          for (let idx = change.oldStart; idx < change.oldEnd; idx++) {
            lastHunk.lines.push({ type: '-', content: oldLines[idx] });
          }
          for (let idx = change.newStart; idx < change.newEnd; idx++) {
            lastHunk.lines.push({ type: '+', content: newLines[idx] });
          }
          
          for (let idx = change.oldEnd; idx < newContextEnd && idx < oldLines.length; idx++) {
            lastHunk.lines.push({ type: ' ', content: oldLines[idx] });
          }
          
          lastHunk.oldCount = newContextEnd - lastHunk.oldStart;
          lastHunk.newCount = lastHunk.oldCount + (change.newEnd - change.newStart) - (change.oldEnd - change.oldStart);
          
          continue;
        }
      }
      
      const hunk: typeof hunks[0] = {
        oldStart: contextStart + 1,
        oldCount: contextEnd - contextStart,
        newStart: contextStart + 1 + accumulatedOffset,
        newCount: contextEnd - contextStart + (change.newEnd - change.newStart) - (change.oldEnd - change.oldStart),
        lines: []
      };
      
      for (let idx = contextStart; idx < change.oldStart; idx++) {
        hunk.lines.push({ type: ' ', content: oldLines[idx] });
      }
      
      for (let idx = change.oldStart; idx < change.oldEnd; idx++) {
        hunk.lines.push({ type: '-', content: oldLines[idx] });
      }
      
      for (let idx = change.newStart; idx < change.newEnd; idx++) {
        hunk.lines.push({ type: '+', content: newLines[idx] });
      }
      
      for (let idx = change.oldEnd; idx < contextEnd && idx < oldLines.length; idx++) {
        hunk.lines.push({ type: ' ', content: oldLines[idx] });
      }
      
      hunks.push(hunk);
      
      accumulatedOffset += (change.newEnd - change.newStart) - (change.oldEnd - change.oldStart);
    }
    
    let addedLines = 0;
    let removedLines = 0;
    
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === '+') addedLines++;
        if (line.type === '-') removedLines++;
      }
    }
    
    let summary = `Updated ${filePath}`;
    if (addedLines > 0 && removedLines > 0) {
      summary += ` with ${addedLines} addition${
        addedLines !== 1 ? "s" : ""
      } and ${removedLines} removal${removedLines !== 1 ? "s" : ""}`;
    } else if (addedLines > 0) {
      summary += ` with ${addedLines} addition${addedLines !== 1 ? "s" : ""}`;
    } else if (removedLines > 0) {
      summary += ` with ${removedLines} removal${
        removedLines !== 1 ? "s" : ""
      }`;
    } else if (changes.length === 0) {
      return `No changes in ${filePath}`;
    }
    
    let diff = summary + "\n";
    diff += `--- a/${filePath}\n`;
    diff += `+++ b/${filePath}\n`;
    
    for (const hunk of hunks) {
      diff += `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@\n`;
      
      for (const line of hunk.lines) {
        diff += `${line.type}${line.content}\n`;
      }
    }
    
    return diff.trim();
  }

  getEditHistory(): EditorCommand[] {
    return [...this.editHistory];
  }

  getHandledToolNames(): string[] {
    return getHandledToolNames(this);
  }
}
