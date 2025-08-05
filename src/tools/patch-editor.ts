import * as fs from "fs-extra";
import * as path from "path";
import { ToolResult } from "../types";

interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  contextBefore: string[];
  contextAfter: string[];
  removedLines: string[];
  addedLines: string[];
}

interface ChangeOperation {
  type: 'keep' | 'remove' | 'add';
  lines: string[];
  lineNumber?: number;
}

interface PatchResult {
  success: boolean;
  appliedHunks: number;
  totalHunks: number;
  error?: string;
  diff?: string;
}

export class PatchEditor {
  private static readonly CONTEXT_LINES = 3;
  private static readonly FUZZ_THRESHOLD = 0.8;

  /**
   * Apply a patch using context-based matching similar to OpenCode
   */
  async applyPatch(
    filePath: string,
    operations: ChangeOperation[]
  ): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(filePath);
      
      if (!(await fs.pathExists(resolvedPath))) {
        return {
          success: false,
          error: `File not found: ${filePath}`
        };
      }

      const content = await fs.readFile(resolvedPath, "utf-8");
      const lines = content.split("\n");
      
      const result = await this.processOperations(lines, operations);
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || "Failed to apply patch"
        };
      }

      const newContent = result.modifiedLines!.join("\n");
      await fs.writeFile(resolvedPath, newContent, "utf-8");

      return {
        success: true,
        output: result.diff || `Successfully patched ${filePath}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Error applying patch to ${filePath}: ${error.message}`
      };
    }
  }

  /**
   * Create a patch from search/replace with context
   */
  async createContextualPatch(
    filePath: string,
    searchText: string,
    replaceText: string,
    contextLines: number = PatchEditor.CONTEXT_LINES
  ): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(filePath);
      
      if (!(await fs.pathExists(resolvedPath))) {
        return {
          success: false,
          error: `File not found: ${filePath}`
        };
      }

      const content = await fs.readFile(resolvedPath, "utf-8");
      const lines = content.split("\n");
      
      const matchResult = this.findContextualMatch(lines, searchText, contextLines);
      
      if (!matchResult) {
        return {
          success: false,
          error: "Could not find search text with sufficient context"
        };
      }

      const operations: ChangeOperation[] = [
        {
          type: 'keep',
          lines: matchResult.contextBefore
        },
        {
          type: 'remove',
          lines: matchResult.matchedLines,
          lineNumber: matchResult.startLine
        },
        {
          type: 'add',
          lines: replaceText.split("\n"),
          lineNumber: matchResult.startLine
        },
        {
          type: 'keep',
          lines: matchResult.contextAfter
        }
      ];

      return this.applyPatch(filePath, operations);
    } catch (error: any) {
      return {
        success: false,
        error: `Error creating contextual patch: ${error.message}`
      };
    }
  }

  /**
   * Smart string replacement using contextual matching
   */
  async smartReplace(
    filePath: string,
    oldStr: string,
    newStr: string
  ): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(filePath);
      
      if (!(await fs.pathExists(resolvedPath))) {
        return {
          success: false,
          error: `File not found: ${filePath}`
        };
      }

      const content = await fs.readFile(resolvedPath, "utf-8");
      const lines = content.split("\n");
      
      // First try exact match
      if (content.includes(oldStr)) {
        const newContent = content.replace(oldStr, newStr);
        await fs.writeFile(resolvedPath, newContent, "utf-8");
        
        const oldLines = content.split("\n");
        const newLines = newContent.split("\n");
        const diff = this.generateUnifiedDiff(oldLines, newLines, filePath);
        
        return {
          success: true,
          output: diff
        };
      }

      // Fall back to contextual matching
      return this.createContextualPatch(filePath, oldStr, newStr);
    } catch (error: any) {
      return {
        success: false,
        error: `Error in smart replace: ${error.message}`
      };
    }
  }

  private async processOperations(
    originalLines: string[],
    operations: ChangeOperation[]
  ): Promise<{
    success: boolean;
    modifiedLines?: string[];
    error?: string;
    diff?: string;
  }> {
    const modifiedLines: string[] = [];
    const appliedChanges: Array<{
      type: 'addition' | 'removal' | 'modification';
      oldStart: number;
      newStart: number;
      oldLines: string[];
      newLines: string[];
    }> = [];
    
    let currentLineIndex = 0;
    
    for (const operation of operations) {
      switch (operation.type) {
        case 'keep':
          // Find and copy matching context lines
          const keepResult = this.findAndKeepLines(
            originalLines,
            currentLineIndex,
            operation.lines
          );
          
          if (!keepResult.found) {
            return {
              success: false,
              error: `Could not find expected context lines at position ${currentLineIndex}`
            };
          }
          
          modifiedLines.push(...keepResult.matchedLines);
          currentLineIndex = keepResult.nextIndex;
          break;

        case 'remove':
          // Skip the lines that should be removed
          const removeResult = this.findAndRemoveLines(
            originalLines,
            currentLineIndex,
            operation.lines
          );
          
          if (!removeResult.found) {
            return {
              success: false,
              error: `Could not find lines to remove at position ${currentLineIndex}`
            };
          }
          
          appliedChanges.push({
            type: 'removal',
            oldStart: currentLineIndex,
            newStart: modifiedLines.length,
            oldLines: removeResult.removedLines,
            newLines: []
          });
          
          currentLineIndex = removeResult.nextIndex;
          break;

        case 'add':
          // Add new lines
          appliedChanges.push({
            type: 'addition',
            oldStart: currentLineIndex,
            newStart: modifiedLines.length,
            oldLines: [],
            newLines: operation.lines
          });
          
          modifiedLines.push(...operation.lines);
          break;
      }
    }

    // Add any remaining lines
    if (currentLineIndex < originalLines.length) {
      modifiedLines.push(...originalLines.slice(currentLineIndex));
    }

    const diff = this.generateUnifiedDiff(originalLines, modifiedLines, "file");
    
    return {
      success: true,
      modifiedLines,
      diff
    };
  }

  private findContextualMatch(
    lines: string[],
    searchText: string,
    contextLines: number
  ): {
    startLine: number;
    endLine: number;
    matchedLines: string[];
    contextBefore: string[];
    contextAfter: string[];
  } | null {
    const searchLines = searchText.split("\n");
    
    for (let i = 0; i <= lines.length - searchLines.length; i++) {
      const candidateLines = lines.slice(i, i + searchLines.length);
      
      if (this.linesMatch(candidateLines, searchLines)) {
        const contextStart = Math.max(0, i - contextLines);
        const contextEnd = Math.min(lines.length, i + searchLines.length + contextLines);
        
        return {
          startLine: i,
          endLine: i + searchLines.length - 1,
          matchedLines: candidateLines,
          contextBefore: lines.slice(contextStart, i),
          contextAfter: lines.slice(i + searchLines.length, contextEnd)
        };
      }
    }
    
    return null;
  }

  private findAndKeepLines(
    originalLines: string[],
    startIndex: number,
    expectedLines: string[]
  ): {
    found: boolean;
    matchedLines: string[];
    nextIndex: number;
  } {
    if (expectedLines.length === 0) {
      return { found: true, matchedLines: [], nextIndex: startIndex };
    }
    
    const endIndex = Math.min(startIndex + expectedLines.length, originalLines.length);
    const candidateLines = originalLines.slice(startIndex, endIndex);
    
    if (this.linesMatch(candidateLines, expectedLines)) {
      return {
        found: true,
        matchedLines: candidateLines,
        nextIndex: endIndex
      };
    }
    
    // Try fuzzy matching
    const fuzzyResult = this.fuzzyMatchLines(
      originalLines,
      startIndex,
      expectedLines
    );
    
    if (fuzzyResult) {
      return fuzzyResult;
    }
    
    return { found: false, matchedLines: [], nextIndex: startIndex };
  }

  private findAndRemoveLines(
    originalLines: string[],
    startIndex: number,
    linesToRemove: string[]
  ): {
    found: boolean;
    removedLines: string[];
    nextIndex: number;
  } {
    if (linesToRemove.length === 0) {
      return { found: true, removedLines: [], nextIndex: startIndex };
    }
    
    const endIndex = Math.min(startIndex + linesToRemove.length, originalLines.length);
    const candidateLines = originalLines.slice(startIndex, endIndex);
    
    if (this.linesMatch(candidateLines, linesToRemove)) {
      return {
        found: true,
        removedLines: candidateLines,
        nextIndex: endIndex
      };
    }
    
    // Try fuzzy matching for removal
    const fuzzyResult = this.fuzzyMatchLines(
      originalLines,
      startIndex,
      linesToRemove
    );
    
    if (fuzzyResult) {
      return {
        found: true,
        removedLines: fuzzyResult.matchedLines,
        nextIndex: fuzzyResult.nextIndex
      };
    }
    
    return { found: false, removedLines: [], nextIndex: startIndex };
  }

  private linesMatch(lines1: string[], lines2: string[]): boolean {
    if (lines1.length !== lines2.length) return false;
    
    return lines1.every((line, index) => 
      this.normalizeForComparison(line) === this.normalizeForComparison(lines2[index])
    );
  }

  private fuzzyMatchLines(
    originalLines: string[],
    startIndex: number,
    expectedLines: string[]
  ): {
    found: boolean;
    matchedLines: string[];
    nextIndex: number;
  } | null {
    const maxSearchWindow = Math.min(expectedLines.length * 2, 10); // Reduced search window
    
    for (let offset = 0; offset <= maxSearchWindow; offset++) {
      const searchStart = startIndex + offset;
      const searchEnd = Math.min(searchStart + expectedLines.length, originalLines.length);
      
      if (searchEnd - searchStart !== expectedLines.length) continue;
      
      // Avoid creating new arrays unless necessary
      const similarity = this.calculateSimilarityInPlace(
        originalLines, searchStart, searchEnd, expectedLines
      );
      
      if (similarity >= PatchEditor.FUZZ_THRESHOLD) {
        return {
          found: true,
          matchedLines: originalLines.slice(searchStart, searchEnd),
          nextIndex: searchEnd
        };
      }
    }
    
    return null;
  }

  private calculateSimilarity(lines1: string[], lines2: string[]): number {
    if (lines1.length !== lines2.length) return 0;
    
    let matches = 0;
    const totalLines = lines1.length;
    
    for (let i = 0; i < totalLines; i++) {
      const similarity = this.stringSimilarity(
        this.normalizeForComparison(lines1[i]),
        this.normalizeForComparison(lines2[i])
      );
      
      if (similarity >= 0.8) matches++;
    }
    
    return matches / totalLines;
  }

  private calculateSimilarityInPlace(
    originalLines: string[],
    startIndex: number,
    endIndex: number,
    expectedLines: string[]
  ): number {
    const length = endIndex - startIndex;
    if (length !== expectedLines.length) return 0;
    
    let matches = 0;
    
    for (let i = 0; i < length; i++) {
      const originalLine = this.normalizeForComparison(originalLines[startIndex + i]);
      const expectedLine = this.normalizeForComparison(expectedLines[i]);
      
      // Quick exact match check first
      if (originalLine === expectedLine) {
        matches++;
        continue;
      }
      
      // Only do expensive similarity calculation if needed
      const similarity = this.stringSimilarity(originalLine, expectedLine);
      if (similarity >= 0.8) matches++;
    }
    
    return matches / length;
  }

  private stringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    // Early exit for performance and memory optimization
    if (str1 === str2) return 0;
    if (str1.length === 0) return str2.length;
    if (str2.length === 0) return str1.length;
    
    // Limit comparison for very long strings to prevent memory issues
    const maxLength = 200;
    if (str1.length > maxLength || str2.length > maxLength) {
      const truncated1 = str1.substring(0, maxLength);
      const truncated2 = str2.substring(0, maxLength);
      return this.levenshteinDistanceOptimized(truncated1, truncated2);
    }
    
    return this.levenshteinDistanceOptimized(str1, str2);
  }

  private levenshteinDistanceOptimized(str1: string, str2: string): number {
    // Use only two rows instead of full matrix to save memory
    const shorter = str1.length <= str2.length ? str1 : str2;
    const longer = str1.length <= str2.length ? str2 : str1;
    
    let previousRow = Array(shorter.length + 1).fill(0).map((_, i) => i);
    let currentRow = Array(shorter.length + 1).fill(0);
    
    for (let i = 1; i <= longer.length; i++) {
      currentRow[0] = i;
      
      for (let j = 1; j <= shorter.length; j++) {
        const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1;
        currentRow[j] = Math.min(
          currentRow[j - 1] + 1,     // insertion
          previousRow[j] + 1,        // deletion
          previousRow[j - 1] + cost  // substitution
        );
      }
      
      // Swap rows
      const temp = previousRow;
      previousRow = currentRow;
      currentRow = temp;
    }
    
    return previousRow[shorter.length];
  }

  private normalizeForComparison(str: string): string {
    return str
      .replace(/\s+/g, ' ')
      .replace(/["'`]/g, '"')
      .trim();
  }

  private generateUnifiedDiff(
    oldLines: string[],
    newLines: string[],
    fileName: string
  ): string {
    const hunks = this.generateHunks(oldLines, newLines);
    
    if (hunks.length === 0) {
      return `No changes in ${fileName}`;
    }
    
    let addedLines = 0;
    let removedLines = 0;
    
    for (const hunk of hunks) {
      addedLines += hunk.addedLines.length;
      removedLines += hunk.removedLines.length;
    }
    
    let diff = `Updated ${fileName}`;
    if (addedLines > 0 && removedLines > 0) {
      diff += ` with ${addedLines} addition${addedLines !== 1 ? "s" : ""} and ${removedLines} removal${removedLines !== 1 ? "s" : ""}`;
    } else if (addedLines > 0) {
      diff += ` with ${addedLines} addition${addedLines !== 1 ? "s" : ""}`;
    } else if (removedLines > 0) {
      diff += ` with ${removedLines} removal${removedLines !== 1 ? "s" : ""}`;
    }
    
    diff += `\n--- a/${fileName}\n+++ b/${fileName}\n`;
    
    for (const hunk of hunks) {
      diff += `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@\n`;
      
      for (const line of hunk.contextBefore) {
        diff += ` ${line}\n`;
      }
      
      for (const line of hunk.removedLines) {
        diff += `-${line}\n`;
      }
      
      for (const line of hunk.addedLines) {
        diff += `+${line}\n`;
      }
      
      for (const line of hunk.contextAfter) {
        diff += ` ${line}\n`;
      }
    }
    
    return diff.trim();
  }

  private generateHunks(oldLines: string[], newLines: string[]): PatchHunk[] {
    const hunks: PatchHunk[] = [];
    const changes = this.findChanges(oldLines, newLines);
    
    for (const change of changes) {
      const contextStart = Math.max(0, change.oldStart - PatchEditor.CONTEXT_LINES);
      const contextEnd = Math.min(oldLines.length, change.oldEnd + PatchEditor.CONTEXT_LINES);
      
      const hunk: PatchHunk = {
        oldStart: contextStart + 1,
        oldCount: contextEnd - contextStart,
        newStart: contextStart + 1,
        newCount: contextEnd - contextStart + (change.newEnd - change.newStart) - (change.oldEnd - change.oldStart),
        contextBefore: oldLines.slice(contextStart, change.oldStart),
        contextAfter: oldLines.slice(change.oldEnd, contextEnd),
        removedLines: oldLines.slice(change.oldStart, change.oldEnd),
        addedLines: newLines.slice(change.newStart, change.newEnd)
      };
      
      hunks.push(hunk);
    }
    
    return hunks;
  }

  private findChanges(oldLines: string[], newLines: string[]): Array<{
    oldStart: number;
    oldEnd: number;
    newStart: number;
    newEnd: number;
  }> {
    const changes = [];
    let i = 0, j = 0;
    
    while (i < oldLines.length || j < newLines.length) {
      // Skip matching lines
      while (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        i++;
        j++;
      }
      
      if (i < oldLines.length || j < newLines.length) {
        const changeStart = { old: i, new: j };
        
        // Find end of change
        while (i < oldLines.length || j < newLines.length) {
          // Look for matching sequence
          let matchFound = false;
          for (let k = 0; k < 3 && !matchFound; k++) {
            if (i + k < oldLines.length && j + k < newLines.length && 
                oldLines[i + k] === newLines[j + k]) {
              matchFound = true;
            }
          }
          
          if (matchFound || (i >= oldLines.length && j >= newLines.length)) {
            break;
          }
          
          if (i < oldLines.length) i++;
          if (j < newLines.length) j++;
        }
        
        changes.push({
          oldStart: changeStart.old,
          oldEnd: i,
          newStart: changeStart.new,
          newEnd: j
        });
      }
    }
    
    return changes;
  }
}