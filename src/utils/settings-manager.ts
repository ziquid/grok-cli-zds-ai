import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * User-level settings stored in ~/.grok/user-settings.json
 * These are global settings that apply across all projects
 */
export interface UserSettings {
  apiKey?: string; // Grok API key
  baseURL?: string; // API base URL
  defaultModel?: string; // User's preferred default model
  models?: string[]; // Available models list
  temperature?: number; // Default temperature for API requests (0.0-2.0, default: 0.7)
  maxTokens?: number; // Default max tokens for API responses (no upper limit, default: undefined = API default)
  startupHook?: string; // Command to run at startup (new sessions only), output added to system prompt
  instanceHook?: string; // Command to run for every instance (new and resumed sessions), output parsed for commands
  prePromptHook?: string; // Command to run before each prompt is sent to the LLM
  taskApprovalHook?: string; // Command to validate task operations (start/transition/stop)
  toolApprovalHook?: string; // Command to validate tool execution before running
  personaHook?: string; // Command to validate persona changes
  personaHookMandatory?: boolean; // Whether persona hook is required
  moodHook?: string; // Command to validate mood changes
  moodHookMandatory?: boolean; // Whether mood hook is required
  contextViewHelper?: string; // Helper for viewing context in text mode (default: $PAGER or less)
  contextViewHelperGui?: string; // Helper for viewing context in GUI mode (default: open on macOS, xdg-open on Linux)
  contextEditHelper?: string; // Helper for editing context in text mode (default: $EDITOR or nano)
  contextEditHelperGui?: string; // Helper for editing context in GUI mode (default: open -e on macOS, xdg-open on Linux)
  mcpServers?: Record<string, any>; // MCP server configurations (fallback from user settings)
}

/**
 * Project-level settings stored in .grok/settings.json
 * These are project-specific settings
 */
export interface ProjectSettings {
  model?: string; // Current model for this project
  mcpServers?: Record<string, any>; // MCP server configurations
}

/**
 * Default values for user settings
 * Note: baseURL and defaultModel are typically set by environment variables or helpers
 */
const DEFAULT_USER_SETTINGS: Partial<UserSettings> = {
  baseURL: "https://api.x.ai/v1", // Grok default
  defaultModel: "grok-code-fast-1",
  models: [
    "grok-code-fast-1",
    "grok-4-latest",
    "grok-3-latest",
    "grok-3-fast",
    "grok-3-mini-fast",
  ],
};

/**
 * Default values for project settings
 */
const DEFAULT_PROJECT_SETTINGS: Partial<ProjectSettings> = {
  model: "grok-code-fast-1",
};

/**
 * Unified settings manager that handles both user-level and project-level settings
 */
export class SettingsManager {
  private static instance: SettingsManager;

  private userSettingsPath: string;
  private projectSettingsPath: string;

  private constructor() {
    // User settings path: ~/.grok/user-settings.json
    this.userSettingsPath = path.join(
      os.homedir(),
      ".grok",
      "user-settings.json"
    );

    // Project settings path: .grok/settings.json (in current working directory)
    this.projectSettingsPath = path.join(
      process.cwd(),
      ".grok",
      "settings.json"
    );
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  /**
   * Ensure directory exists for a given file path
   */
  private ensureDirectoryExists(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Load user settings from ~/.grok/user-settings.json
   */
  public loadUserSettings(): UserSettings {
    try {
      if (!fs.existsSync(this.userSettingsPath)) {
        // Create default user settings if file doesn't exist
        this.saveUserSettings(DEFAULT_USER_SETTINGS);
        return { ...DEFAULT_USER_SETTINGS };
      }

      const content = fs.readFileSync(this.userSettingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Merge with defaults to ensure all required fields exist
      return { ...DEFAULT_USER_SETTINGS, ...settings };
    } catch (error) {
      console.warn(
        "Failed to load user settings:",
        error instanceof Error ? error.message : "Unknown error"
      );
      return { ...DEFAULT_USER_SETTINGS };
    }
  }

  /**
   * Save user settings to ~/.grok/user-settings.json
   */
  public saveUserSettings(settings: Partial<UserSettings>): void {
    try {
      this.ensureDirectoryExists(this.userSettingsPath);

      // Read existing settings directly to avoid recursion
      let existingSettings: UserSettings = { ...DEFAULT_USER_SETTINGS };
      if (fs.existsSync(this.userSettingsPath)) {
        try {
          const content = fs.readFileSync(this.userSettingsPath, "utf-8");
          const parsed = JSON.parse(content);
          existingSettings = { ...DEFAULT_USER_SETTINGS, ...parsed };
        } catch (error) {
          // If file is corrupted, use defaults
          console.warn("Corrupted user settings file, using defaults");
        }
      }

      const mergedSettings = { ...existingSettings, ...settings };

      fs.writeFileSync(
        this.userSettingsPath,
        JSON.stringify(mergedSettings, null, 2),
        { mode: 0o600 } // Secure permissions for API key
      );
    } catch (error) {
      console.error(
        "Failed to save user settings:",
        error instanceof Error ? error.message : "Unknown error"
      );
      throw error;
    }
  }

  /**
   * Update a specific user setting
   */
  public updateUserSetting<K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ): void {
    const settings = { [key]: value } as Partial<UserSettings>;
    this.saveUserSettings(settings);
  }

  /**
   * Get a specific user setting
   */
  public getUserSetting<K extends keyof UserSettings>(key: K): UserSettings[K] {
    const settings = this.loadUserSettings();
    return settings[key];
  }

  /**
   * Load project settings from .grok/settings.json
   */
  public loadProjectSettings(): ProjectSettings {
    try {
      if (!fs.existsSync(this.projectSettingsPath)) {
        // Return defaults without creating file
        return { ...DEFAULT_PROJECT_SETTINGS };
      }

      const content = fs.readFileSync(this.projectSettingsPath, "utf-8");

      // Handle empty files
      if (!content.trim()) {
        return { ...DEFAULT_PROJECT_SETTINGS };
      }

      const settings = JSON.parse(content);

      // Merge with defaults
      return { ...DEFAULT_PROJECT_SETTINGS, ...settings };
    } catch (error) {
      console.warn(
        "Failed to load project settings:",
        error instanceof Error ? error.message : "Unknown error"
      );
      return { ...DEFAULT_PROJECT_SETTINGS };
    }
  }

  /**
   * Save project settings to .grok/settings.json
   * Note: This is a no-op - project settings are not used in ZDS agent workflow
   */
  public saveProjectSettings(settings: Partial<ProjectSettings>): void {
    // Do nothing - all settings are stored in ~/.grok/user-settings.json
    // This prevents creating .grok/settings.json files scattered around the filesystem
  }

  /**
   * Update a specific project setting
   */
  public updateProjectSetting<K extends keyof ProjectSettings>(
    key: K,
    value: ProjectSettings[K]
  ): void {
    const settings = { [key]: value } as Partial<ProjectSettings>;
    this.saveProjectSettings(settings);
  }

  /**
   * Get a specific project setting
   */
  public getProjectSetting<K extends keyof ProjectSettings>(
    key: K
  ): ProjectSettings[K] {
    const settings = this.loadProjectSettings();
    return settings[key];
  }

  /**
   * Get the current model with proper fallback logic:
   * 1. Project-specific model setting
   * 2. User's default model
   * 3. System default
   */
  public getCurrentModel(): string {
    const projectModel = this.getProjectSetting("model");
    if (projectModel) {
      return projectModel;
    }

    const userDefaultModel = this.getUserSetting("defaultModel");
    if (userDefaultModel) {
      return userDefaultModel;
    }

    return DEFAULT_PROJECT_SETTINGS.model || "grok-code-fast-1";
  }

  /**
   * Set the current model for the project
   */
  public setCurrentModel(model: string): void {
    this.updateProjectSetting("model", model);
  }

  /**
   * Get available models list from user settings
   */
  public getAvailableModels(): string[] {
    const models = this.getUserSetting("models");
    return models || DEFAULT_USER_SETTINGS.models || [];
  }

  /**
   * Get API key from user settings or environment
   */
  public getApiKey(): string | undefined {
    // First check environment variable
    const envApiKey = process.env.GROK_API_KEY;
    if (envApiKey) {
      return envApiKey;
    }

    // Then check user settings
    return this.getUserSetting("apiKey");
  }

  /**
   * Get startup hook command from user settings
   */
  public getStartupHook(): string | undefined {
    return this.getUserSetting("startupHook");
  }

  /**
   * Get instance hook command from user settings
   */
  public getInstanceHook(): string | undefined {
    return this.getUserSetting("instanceHook");
  }

  /**
   * Get task approval hook command from user settings
   * Used for validating all task operations (start/transition/stop)
   */
  public getTaskApprovalHook(): string | undefined {
    return this.getUserSetting("taskApprovalHook");
  }

  /**
   * Get tool approval hook command from user settings
   */
  public getToolApprovalHook(): string | undefined {
    return this.getUserSetting("toolApprovalHook");
  }

  /**
   * Get persona hook command from user settings
   */
  public getPersonaHook(): string | undefined {
    return this.getUserSetting("personaHook");
  }

  /**
   * Check if persona hook is mandatory
   */
  public isPersonaHookMandatory(): boolean {
    return this.getUserSetting("personaHookMandatory") ?? false;
  }

  /**
   * Get mood hook command from user settings
   */
  public getMoodHook(): string | undefined {
    return this.getUserSetting("moodHook");
  }

  /**
   * Check if mood hook is mandatory
   */
  public isMoodHookMandatory(): boolean {
    return this.getUserSetting("moodHookMandatory") ?? false;
  }

  /**
   * Get prePrompt hook command from user settings
   */
  public getPrePromptHook(): string | undefined {
    return this.getUserSetting("prePromptHook");
  }

  /**
   * Detect if we're running in a GUI environment or text-only (SSH/terminal)
   * Returns true if GUI is available, false for text-only
   */
  public isGuiAvailable(): boolean {
    // Check if SSH session
    if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) {
      return false;
    }

    // Check platform-specific GUI indicators
    if (process.platform === "darwin") {
      // macOS: Check if we have GUI session (not ssh, not screen/tmux)
      return !process.env.STY && !process.env.TMUX;
    } else if (process.platform === "linux") {
      // Linux: Check for X11 or Wayland display
      return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    } else if (process.platform === "win32") {
      // Windows: Assume GUI available unless in WSL SSH
      return true;
    }

    // Default to text-only if uncertain
    return false;
  }

  /**
   * Get context view helper command from user settings
   * Auto-detects GUI vs text-only environment
   */
  public getContextViewHelper(): string {
    const isGui = this.isGuiAvailable();

    if (isGui) {
      // GUI mode
      const guiHelper = this.getUserSetting("contextViewHelperGui");
      if (guiHelper) {
        return guiHelper;
      }

      // Platform-specific GUI defaults
      if (process.platform === "darwin") {
        return "open"; // macOS: open in default app
      } else if (process.platform === "linux") {
        return "xdg-open"; // Linux: open in default app
      } else if (process.platform === "win32") {
        return "start"; // Windows: open in default app
      }
    }

    // Text mode
    const textHelper = this.getUserSetting("contextViewHelper");
    if (textHelper) {
      return textHelper;
    }

    // Fall back to environment variable
    const pager = process.env.PAGER;
    if (pager) {
      return pager;
    }

    // Fall back to common pagers
    return "less -R"; // -R for color support
  }

  /**
   * Get context edit helper command from user settings
   * Auto-detects GUI vs text-only environment
   */
  public getContextEditHelper(): string {
    const isGui = this.isGuiAvailable();

    if (isGui) {
      // GUI mode
      const guiHelper = this.getUserSetting("contextEditHelperGui");
      if (guiHelper) {
        return guiHelper;
      }

      // Platform-specific GUI defaults
      if (process.platform === "darwin") {
        return "open -e"; // macOS: open in TextEdit
      } else if (process.platform === "linux") {
        return "xdg-open"; // Linux: open in default editor
      } else if (process.platform === "win32") {
        return "notepad"; // Windows: Notepad
      }
    }

    // Text mode
    const textHelper = this.getUserSetting("contextEditHelper");
    if (textHelper) {
      return textHelper;
    }

    // Fall back to environment variables
    const editor = process.env.EDITOR || process.env.VISUAL;
    if (editor) {
      return editor;
    }

    // Fall back to common editors
    return "nano";
  }

  /**
   * Get base URL from user settings or environment
   */
  public getBaseURL(): string {
    // First check environment variable
    const envBaseURL = process.env.GROK_BASE_URL;
    if (envBaseURL) {
      return envBaseURL;
    }

    // Then check user settings, then use default
    const userBaseURL = this.getUserSetting("baseURL");
    return userBaseURL || DEFAULT_USER_SETTINGS.baseURL || "https://api.x.ai/v1";
  }

  /**
   * Get temperature from user settings
   * Defaults to 0.7 if not set
   */
  public getTemperature(): number {
    const temperature = this.getUserSetting("temperature");
    if (temperature !== undefined && temperature >= 0 && temperature <= 2) {
      return temperature;
    }
    return 0.7; // Default temperature
  }

  /**
   * Get max tokens from user settings or environment
   * Priority: user settings > ZDS_AI_AGENT_MAX_TOKENS env var > undefined
   * Returns undefined if not set (allows API to use its default)
   */
  public getMaxTokens(): number | undefined {
    // First check user settings
    const settingsMaxTokens = this.getUserSetting("maxTokens");
    if (settingsMaxTokens !== undefined && Number.isInteger(settingsMaxTokens) && settingsMaxTokens > 0) {
      return settingsMaxTokens;
    }

    // Then check environment variable (set by hooks)
    const envMaxTokens = process.env.ZDS_AI_AGENT_MAX_TOKENS;
    if (envMaxTokens) {
      const parsed = parseInt(envMaxTokens);
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return undefined; // No default - let API decide
  }
}

/**
 * Convenience function to get the singleton instance
 */
export function getSettingsManager(): SettingsManager {
  return SettingsManager.getInstance();
}
