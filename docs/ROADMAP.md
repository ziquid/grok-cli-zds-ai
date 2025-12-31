# ZDS CLI Roadmap

## Version 0.1.9

### Features

- [🔘] 1: HOOKS
  - [🔘] 1.1: Rename prePrompt to preLLMResponse
  - [  ] 1.2: Add postUserInput hook
  - [  ] 1.3: Add postLLMResponse hook
  - [  ] 1.4: Add preToolCall hook
  - [  ] 1.5: Add postToolCall hook

- [  ] 2: HOOK COMMANDS
  - [  ] 2.1: Add MAXCONTEXT command for setting maximum context length

- [  ] 3: CODE IMPROVEMENTS
  - [  ] 3.1: Introduce StreamingLLMAgent class
  - [✅] 3.2: Move sessionState to top of context.json file

- [  ] 4: Tool enhancements
  - [  ] 4.1: Add encode-speech tool
  - [🔘] 4.2: Add getLoraDetails to ImageTool
  - [  ] 4.3: Add compareImageToPrompt to ImageTool
  - [  ] 4.4: Add joycaption to repository

- [✅] 5: TECHNICAL DEBT
  - [✅] 5.1: Reduce duplicate code in llm-agent.ts
  - [✅] 5.2: Refactor llm-agent.ts to move tasks to helpers

- [🔘] 6: DOCUMENTATION IMPROVEMENTS
  - [✅] 6.1: Update the morph tool instructions
  - [  ] 6.2: Update the README
  - [✅] 6.3: Documented classes in src/agent


### Bug Fixes

- [  ] 1: Save permanent prompt vars with context.json

## Version 0.2.0

### Features

- [  ] 1: CODE IMPROVEMENTS
  - [  ] 1.1: Start separating FE and BE
