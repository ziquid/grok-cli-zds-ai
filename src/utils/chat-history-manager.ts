import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ChatEntry } from "../agent/grok-agent";

const HISTORY_FILE_NAME = "chat-history.json";
const HISTORY_DIR = path.join(os.homedir(), ".grok");

/**
 * Manages chat history persistence to ~/.grok/chat-history.json or custom path
 */
export class ChatHistoryManager {
  private static instance: ChatHistoryManager;
  private static customHistoryFilePath: string | null = null;
  private historyFilePath: string;

  private constructor() {
    this.historyFilePath = ChatHistoryManager.customHistoryFilePath || path.join(HISTORY_DIR, HISTORY_FILE_NAME);
    this.ensureHistoryDirExists();
  }

  /**
   * Set a custom history file path (must be called before getInstance)
   */
  static setCustomHistoryPath(filePath: string): void {
    ChatHistoryManager.customHistoryFilePath = filePath;
  }

  static getInstance(): ChatHistoryManager {
    if (!ChatHistoryManager.instance) {
      ChatHistoryManager.instance = new ChatHistoryManager();
    }
    return ChatHistoryManager.instance;
  }

  private ensureHistoryDirExists(): void {
    const dir = path.dirname(this.historyFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Load chat history from file
   */
  loadHistory(): ChatEntry[] {
    try {
      if (!fs.existsSync(this.historyFilePath)) {
        return [];
      }

      const data = fs.readFileSync(this.historyFilePath, "utf-8");
      const parsed = JSON.parse(data);

      // Deserialize dates and validate entries
      return parsed
        .map((entry: any) => {
          try {
            if (!entry.type || !entry.content || !entry.timestamp) {
              console.warn("Skipping invalid chat entry:", entry);
              return null;
            }
            return {
              ...entry,
              timestamp: new Date(entry.timestamp),
            };
          } catch (entryError) {
            console.warn("Failed to parse chat entry:", entry, entryError);
            return null;
          }
        })
        .filter((entry): entry is ChatEntry => entry !== null);
    } catch (error) {
      console.warn("Failed to load chat history:", error);
      return [];
    }
  }

  /**
   * Save chat history to file
   */
  saveHistory(history: ChatEntry[]): void {
    try {
      // Serialize dates
      const serialized = history.map(entry => ({
        ...entry,
        timestamp: entry.timestamp.toISOString(),
      }));

      fs.writeFileSync(this.historyFilePath, JSON.stringify(serialized, null, 2));
    } catch (error) {
      console.warn("Failed to save chat history:", error);
    }
  }

  /**
   * Clear chat history file
   */
  clearHistory(): void {
    try {
      if (fs.existsSync(this.historyFilePath)) {
        fs.unlinkSync(this.historyFilePath);
      }
    } catch (error) {
      console.warn("Failed to clear chat history:", error);
    }
  }
}