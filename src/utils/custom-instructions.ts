import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function loadCustomInstructions(workingDirectory: string = process.cwd()): string | null {
  try {
    let instructions = '';

    // Load user-level instructions first (~/.grok/GROK.md)
    const userInstructionsPath = path.join(os.homedir(), '.grok', 'GROK.md');
    if (fs.existsSync(userInstructionsPath)) {
      const userInstructions = fs.readFileSync(userInstructionsPath, 'utf-8').trim();
      if (userInstructions) {
        instructions += userInstructions + '\n\n';
      }
    }

    // Load project-level instructions (./.grok/GROK.md)
    const projectInstructionsPath = path.join(workingDirectory, '.grok', 'GROK.md');
    if ((userInstructionsPath !== projectInstructionsPath) && fs.existsSync(projectInstructionsPath)) {
      const projectInstructions = fs.readFileSync(projectInstructionsPath, 'utf-8').trim();
      if (projectInstructions) {
        instructions += projectInstructions;
      }
    }

    return instructions.trim() || null;
  } catch (error) {
    console.warn('Failed to load custom instructions:', error);
    return null;
  }
}