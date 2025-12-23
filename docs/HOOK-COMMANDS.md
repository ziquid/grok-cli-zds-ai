# Hook Commands Reference

This document describes the hook command system in zai-cli.  When you write hooks for your zai-cli configuration, you can return these commands via stdout to control the CLI's behavior dynamically.

## Table of Contents

- [Overview](#overview)
- [Command Reference](#command-reference)
   - [API_KEY_ENV_VAR](#api_key_env_var)
   - [BACKEND](#backend)
   - [BASE_URL](#base_url)
   - [ECHO](#echo)
   - [ENV](#env)
   - [MODEL](#model)
   - [PREFILL](#prefill)
   - [RUN](#run)
   - [SET](#set)
   - [SET_FILE](#set_file)
   - [SET_TEMP_FILE](#set_temp_file)
   - [SYSTEM](#system)
   - [SYSTEM_FILE](#system_file)
   - [TOOL_RESULT](#tool_result)
- [Hook Types](#hook-types)
- [Examples](#examples)

## Overview

Hooks return commands by echoing them to stdout.  Each command consists of a keyword followed by its value:

```text
COMMAND_NAME value
```

Any line that doesn't match a recognized command is treated as `TOOL_RESULT` content.

## Command Reference

### API_KEY_ENV_VAR

Specify which environment variable contains the API key.  Must be used with `BACKEND` and `BASE_URL`.

**Syntax:**

```text
API_KEY_ENV_VAR ENV_VARIABLE_NAME
```

**Notes:**

- Only effective when combined with `BACKEND` command
- Last occurrence wins if multiple commands present

---

### BACKEND

Switch to a different backend service.  Must be used with `BASE_URL` and `API_KEY_ENV_VAR`.

**Syntax:**

```text
BACKEND backend_name
BASE_URL https://api.endpoint.com
API_KEY_ENV_VAR ENV_VAR_NAME
```

**Supported backends:**

- `arliai`
- `grok`
- `nanogpt`
- `ollama`
- `openai`
- `openrouter`
- `plano`
- `venice`

**Notes:**

- Backend change is tested before being applied
- If test fails, hook is rejected
- Last occurrence wins if multiple commands present

**Example:**

```text
BACKEND grok
BASE_URL https://api.x.ai/v1
API_KEY_ENV_VAR GROK_API_KEY
```

---

### BASE_URL

Set the API base URL.  Must be used with `BACKEND` and `API_KEY_ENV_VAR`.

**Syntax:**

```text
BASE_URL https://api.endpoint.com
```

**Notes:**

- Only effective when combined with `BACKEND` command
- Last occurrence wins if multiple commands present

---

### ECHO

*(Reserved for future use)*

**Syntax:**

```text
ECHO message
```

---

### ENV

Set environment variables for the session.  Variables are automatically prefixed with `ZDS_AI_AGENT_` if not already prefixed.

**Syntax:**

```text
ENV VARIABLE_NAME=value
```

**Special behavior:**

- Empty value (`VAR=`) unsets the variable
- Variables without `ZDS_AI_AGENT_` prefix are auto-prefixed
- Changes persist for the current session

**Example:**

```text
ENV DEBUG_MODE=1
ENV API_ENDPOINT=https://api.example.com
ENV TEMP_VAR=  # Unsets TEMP_VAR
```

---

### MODEL

Switch to a different model.

**Syntax:**

```text
MODEL model_name
```

**Notes:**

- Model change is tested before being applied
- If test fails, hook is rejected
- Last occurrence wins if multiple commands present

**Example:**

```text
MODEL grok-beta
```

---

### PREFILL

Prefill the assistant's next response with specific text.  The LLM will continue from this starting point.

**Syntax:**

```text
PREFILL text to start the response
```

**Notes:**

- Adds an assistant message with the prefill text before the API call
- The LLM continues generating from this text
- Complete response (prefill + continuation) is shown to user
- Last occurrence wins if multiple commands present
- Cleared after use

**Example:**

```text
PREFILL Sure, I'd be happy to help with that.
```

**Use cases:**

- Guide response style or tone
- Ensure specific opening phrases
- Direct the response format

**Difference from `/rephrase` prefill:**

- `/rephrase` prefill: For rephrasing the **last** response
- `PREFILL` hook: For starting the **next** response

---

### RUN

*(Reserved for future use)*

**Syntax:**

```text
RUN command
```

---

### SET

Set a prompt variable with text content.

**Syntax:**

```text
SET NAMESPACE:VARIABLE=value
```

**Notes:**

- Variable names must match pattern `[A-Z]+:[A-Z]+`
- Text values limited to 10,000 bytes
- Larger values are truncated with a note
- Variables can be referenced in prompts with `${NAMESPACE:VARIABLE}`

**Example:**

```text
SET USER:NAME=Alice
SET PROJECT:STATUS=in-progress
SET TASK:PRIORITY=high
```

---

### SET_FILE

Set a prompt variable by reading file contents.

**Syntax:**

```text
SET_FILE NAMESPACE:VARIABLE=/path/to/file
```

**Notes:**

- Variable names must match pattern `[A-Z]+:[A-Z]+`
- Supports `~` expansion for home directory
- File size limited to 20,000 bytes
- Larger files are truncated with a note
- Errors are stored as variable value

**Example:**

```text
SET_FILE PROJECT:README=~/project/README.md
SET_FILE USER:CONFIG=~/.config/settings.json
```

---

### SET_TEMP_FILE

Set a prompt variable by reading file contents, then delete the file.

**Syntax:**

```text
SET_TEMP_FILE NAMESPACE:VARIABLE=/path/to/temp/file
```

**Notes:**

- Same behavior as `SET_FILE`
- File is deleted after reading (even if read fails)
- Useful for hooks that generate temporary files

**Example:**

```text
SET_TEMP_FILE ANALYSIS:RESULT=/tmp/analysis-result.txt
```

---

### SYSTEM

Add a system message to the conversation.

**Syntax:**

```text
SYSTEM system message content
```

**Notes:**

- Multiple `SYSTEM` commands are aggregated with newlines
- System message is added to the messages array before API call

**Example:**

```text
SYSTEM You are in debugging mode.  Be extra verbose.
SYSTEM Current task: analyzing performance bottlenecks
```

---

### SYSTEM_FILE

Read a file and add its contents as a system message.

**Syntax:**

```text
SYSTEM_FILE /path/to/file
```

**Notes:**

- Supports `~` expansion for home directory
- File size limited to 20,000 bytes
- Larger files are truncated with a note
- Multiple files are aggregated
- Errors are added as system message content

**Example:**

```text
SYSTEM_FILE ~/project/context.txt
SYSTEM_FILE ~/.config/instructions.md
```

---

### TOOL_RESULT

Add content to be shown as tool output.  Multiple `TOOL_RESULT` lines are aggregated.

**Syntax:**

```text
TOOL_RESULT content to display
```

**Notes:**

- Lines without a command prefix are automatically treated as `TOOL_RESULT`
- Content is aggregated into a single string with newlines

**Example:**

```text
TOOL_RESULT File processed successfully
TOOL_RESULT Found 42 matching records
```

---

## Hook Types

Different hooks are executed at different points in the message processing flow:

### Instance Hook

- **When:** Once per session after first `clearOneShot()`
- **Purpose:** Session-wide initialization
- **Commands allowed:** All commands
- **Example:** Set up session variables, configure backend

### Mood Hook

- **When:** When mood is changed via `/mood` command
- **Purpose:** Validate and configure mood changes
- **Commands allowed:** All commands

### Persona Hook

- **When:** When persona is changed via `/persona` command
- **Purpose:** Validate and configure persona changes
- **Commands allowed:** All commands

### PrePrompt Hook

- **When:** Before the messages array is sent to the LLM
- **Purpose:** Modify or augment the request being sent to the LLM
- **Commands allowed:** All commands
- **Example:** Add context, set variables, modify system message

### Startup Hook

- **When:** When zai-cli starts or context is cleared
- **Purpose:** Initialize session state
- **Commands allowed:** All commands

### Tool Approval Hook

- **When:** Before executing each tool
- **Purpose:** Validate and potentially transform tool arguments
- **Commands allowed:** All commands
- **Special:** Can transform tool arguments via ENV variable

---

## Examples

### Example 1: Debug Mode Hook

```zsh
#!/usr/bin/env zsh
# prePrompt hook that enables debug mode for specific keywords

if [[ "$ZDS_AI_AGENT_USER_MESSAGE" =~ debug|trace|diagnose ]]; then
  echo ENV DEBUG_MODE=1
  echo SYSTEM You are in debug mode.  Provide detailed explanations.
  echo PREFILL Let me analyze this in detail.
fi
```

### Example 2: Context-Aware System Message

```zsh
#!/usr/bin/env zsh
# instance hook that loads project context

PROJECT_ROOT=/path/to/project

if [[ -f "$PROJECT_ROOT/.ai-context.md" ]]; then
  echo SYSTEM_FILE "$PROJECT_ROOT/.ai-context.md"
fi

echo SET PROJECT:ROOT="$PROJECT_ROOT"
echo SET_FILE PROJECT:README="$PROJECT_ROOT/README.md"
```

### Example 3: Dynamic Backend Switching

```zsh
#!/usr/bin/env zsh
# prePrompt hook that switches to Grok for certain queries

if [[ "$ZDS_AI_AGENT_USER_MESSAGE" =~ "real-time|current|latest news" ]]; then
  echo BACKEND grok
  echo BASE_URL https://api.x.ai/v1
  echo API_KEY_ENV_VAR GROK_API_KEY
  echo MODEL grok-beta
  echo SYSTEM Use search capabilities to find current information
fi
```

### Example 4: Response Prefilling

```zsh
#!/usr/bin/env zsh
# prePrompt hook that guides response style

case "$ZDS_AI_AGENT_USER_MESSAGE" in
  *explain*|*how\ does*)
    echo PREFILL Let me break this down step by step.
    ;;
  *code*|*implement*)
    echo PREFILL I\'ll help you implement this.  Here\'s my approach:
    ;;
  *fix*|*bug*)
    echo PREFILL I\'ll analyze this issue.  First,
    ;;
esac
```

### Example 5: Temporary Analysis File

```zsh
#!/usr/bin/env zsh
# tool approval hook that analyzes file before operations

TEMP_FILE=$(mktemp)

# Run analysis and save to temp file
analyze-file "$TARGET_FILE" > "$TEMP_FILE"

echo SET_TEMP_FILE ANALYSIS:REPORT="$TEMP_FILE"
echo SYSTEM Review the analysis report before proceeding
```

### Example 6: Multi-Command Combination

```zsh
#!/usr/bin/env zsh
# Complex hook combining multiple commands

# Set environment
echo ENV SESSION_MODE=research
echo ENV MAX_TOKENS=4000

# Load context files
echo SYSTEM_FILE ~/research/context.md
echo SET_FILE RESEARCH:NOTES=~/research/notes.md

# Configure model
echo MODEL grok-beta

# Prefill response
echo PREFILL Based on the research context provided,

# Add tool result
echo TOOL_RESULT Research mode activated with extended context
```

---

## Notes

1. **Testing**

   - Backend/model changes get tested automatically before application
   - Test hook logic manually before relying on it

1. **Command Usage**

   - `PREFILL` guides the assistant's response style, doesn't inject conversation history
   - `SYSTEM` adds instructions, `TOOL_RESULT` adds information

1. **Error Handling**

   - File operations can fail -- handle this in your hooks
   - Missing files produce error messages but don't reject the hook

1. **File Sizes**

   - Keep context files small for performance
   - Large files impact token usage

1. **Variable Naming**

   - Use consistent namespace conventions in SET commands
   - Examples: `USER:*` for user data, `PROJECT:*` for project context, `ANALYSIS:*` for results

1. **Performance**

   - Hooks run synchronously and add latency
   - For expensive operations, generate temp files instead of blocking

---

## Technical Notes

### Command Parsing

- Commands are parsed line-by-line from hook stdout
- Lines are trimmed before processing
- Empty lines are ignored
- Command matching is prefix-based and case-sensitive

### Execution Order

1. Hook is executed
1. Commands are parsed from stdout
1. Environment variables are extracted (not yet applied)
1. Prompt variables (SET*) are applied
1. Backend/model changes are tested
1. If tests pass: ENV variables applied, SYSTEM added, PREFILL stored
1. If tests fail: hook is rejected, no changes applied

### Error Handling

- File read errors: Error message replaces content
- Backend test failure: Hook rejected
- Model test failure: Hook rejected
- Malformed commands: Treated as TOOL_RESULT
