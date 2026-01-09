# ZDS CLI Roadmap

## Version 0.1.9

### Features

- [✅] 1: HOOKS
  - [✅] 1.1: Rename prePrompt to preLLMResponse
  - [✅] 1.2: Add postUserInput hook
  - [✅] 1.3: Add postLLMResponse hook
  - [✅] 1.4: Add preToolCall hook
  - [✅] 1.5: Add postToolCall hook

- [  ] 2: HOOK COMMANDS
  - [  ] 2.1: Add MAXCONTEXT command for setting maximum context length

- [🔘] 3: CODE IMPROVEMENTS
  - [  ] 3.1: Introduce StreamingLLMAgent class
  - [✅] 3.2: Move sessionState to top of context.json file

- [🔘] 4: Tool enhancements
  - [✅] 4.1: Add encode-speech tool
  - [✅] 4.2: Add getLoraDetails to ImageTool
  - [  ] 4.3: Add compareImageToPrompt to ImageTool
  - [  ] 4.4: Add joycaption to repository

- [✅] 5: TECHNICAL DEBT
  - [✅] 5.1: Reduce duplicate code in llm-agent.ts
  - [✅] 5.2: Refactor llm-agent.ts to move tasks to helpers

- [🔘] 6: DOCUMENTATION IMPROVEMENTS
  - [✅] 6.1: Update the morph tool instructions
  - [  ] 6.2: Update the README
  - [✅] 6.3: Documented classes in src/agent
  - [✅] 6.4: Add AGENTS.md

- [✅] 7: CLI USABILITY IMPROVEMENTS
  - [✅] 7.1: Add `/? ` as shorter alias for `/introspect` command
  - [✅] 7.2: Enhanced `/? ` (introspect) output formatting
    - Added color-coded output (cyan for values, yellow for properties, magenta for templates, dim for comments)
    - Improved YAML-like tree structure for variable definitions
    - Show explicit/implicit indicator for variable definitions
    - Display current values in def: output when available
    - Better error messages suggesting def: when var: not found

- [✅] 8: FILE LOCATION MIGRATION
  - [✅] 8.1: Move settings from ~/.grok/ to ~/.zds-ai/
    - User settings: ~/.grok/user-settings.json → ~/.zds-ai/cli-settings.json
    - MCP config: ~/.grok/mcp.json → ~/.zds-ai/mcp.json
    - Project settings: .grok/settings.json → .zds-ai/project-settings.json
    - Chat history: ~/.grok/chat-history.json → ~/.zds-ai/context.json

- [✅] 9: PROMPT VARIABLE SYSTEM IMPROVEMENTS
  - [✅] 9.1: Add SESSION variables for session state tracking
    - SESSION:BACKEND:MODEL (weight 10, persistent)
    - SESSION:BACKEND:SERVICE (weight 20, persistent)
    - SESSION:FRONTEND (weight 30, persistent)
    - SESSION:STDIN_IS_TTY (weight 31, persistent)
    - SESSION:STDOUT_IS_TTY (weight 31, persistent)
  - [✅] 9.2: Dynamic system message rendering
    - System prompt now renders from variables before each LLM call
    - `getSystemPrompt()` automatically renders current variable state
    - `setSystemPrompt()` deprecated - always renders from variables
    - Ensures instance hook variables always included in fresh sessions
    - `renderSystemMessage()` method added to LLMAgent and HookManager


### Bug Fixes

- [✅] 1: Fixed backend/model switching regression (dependency injection using getters)
- [✅] 2: Fixed session state persistence (persona, apiKeyEnvVar now save correctly)
- [✅] 3: Fixed hook prompt variable commands (SET, SET_FILE, SET_TEMP_FILE) not being applied
- [✅] 4: Fixed hook ENV commands not being applied in llm-agent.ts hooks
- [  ] 5: Save permanent prompt vars with context.json
- [✅] 6: Fixed /introspect and /? commands not showing user input in chat history
- [✅] 7: Fixed SET/SET_FILE/SET_TEMP_FILE regex to allow underscores in variable names
- [✅] 8: Fixed XML wrapping logic for prompt variables (now checks child's template, not parent's)
- [✅] 9: Fixed findBirthChildren to only return immediate children, not grandchildren
- [✅] 10: Fixed var: output showing "Values (0)" - now shows "No direct values (renders from children/getter)"
- [✅] 11: Fixed var: output not showing children (now displays children list matching def: output)
- [✅] 12: Fixed empty child wrapper tags being rendered - now only creates XML wrappers when child has content
- [✅] 13: Fixed orphaned grandchildren not appearing in parent render - automatically creates intermediate parents (e.g., MESSAGE:ACL when MESSAGE:ACL:CURRENT exists)

## Version 0.2.0

### Features

- [  ] 1: CODE IMPROVEMENTS
  - [  ] 1.1: Start separating FE and BE
  - [  ] 1.2: Refactor settings manager
    - Clean up settings-manager.ts code structure
    - Improve error handling and validation
    - Simplify the interface for loading/saving settings
    - Better separation of user vs project settings

- [  ] 2: DATA PERSISTENCE
  - [  ] 2.1: Migrate context storage from JSON files to SQLite database
    - Replace context.json with SQLite schema
    - Maintain backward compatibility for reading old JSON files
    - Improve query performance for large conversation histories
    - Enable better analytics and search capabilities
