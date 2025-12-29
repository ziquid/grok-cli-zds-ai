import { execSync } from "child_process";
import * as os from 'os';

/**
 * Expand tilde in path to home directory
 * Supports ~, ~/path, and ~username/path
 */
export function expandHomeDir(filePath: string): string {
  if (!filePath.startsWith("~")) {
    return filePath;
  }

  // Handle ~ or ~/path (current user)
  if (filePath === "~" || filePath.startsWith("~/")) {
    return filePath.replace("~", os.homedir());
  }

  // Handle ~username/path (other users)
  // Extract username from ~username/path
  const match = filePath.match(/^~([^/]+)(\/.*)?$/);
  if (match) {
    const username = match[1];
    const restOfPath = match[2] || "";

    try {
      // Use shell to expand ~username
      const expandedHome = execSync(`eval echo ~${username}`, { encoding: 'utf-8' }).trim();
      return expandedHome + restOfPath;
    } catch (_error) {
      // If expansion fails, return original path
      return filePath;
    }
  }

  return filePath;
}
