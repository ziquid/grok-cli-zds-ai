import * as os from 'os';
import * as path from 'path';

/**
 * Expands ~ in file paths to the user's home directory
 */
export function expandHomeDir(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}