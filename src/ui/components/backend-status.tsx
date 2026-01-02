import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { LLMAgent } from "../../agent/llm-agent.js";

interface BackendStatusProps {
  agent?: LLMAgent;
}

/**
 * Truncate backend/model display by removing vowel groups from left to right
 * Vowel groups at the start of words are preserved
 * @param display The display string to truncate
 * @param maxLength Maximum length (default 38, which is 40 minus icon and nbsp)
 */
function truncateBackendModel(display: string, maxLength: number = 38): string {
  if (display.length <= maxLength) {
    return display;
  }

  const vowels = /[aeiou]/i;
  const wordBoundary = /[:\/-]/;

  // Track positions to remove
  const toRemove = new Set<number>();
  let i = 0;

  while (i < display.length) {
    // Check if we've truncated enough
    if (display.length - toRemove.size <= maxLength) {
      break;
    }

    if (vowels.test(display[i])) {
      // Check if at word start (beginning of string or after boundary)
      const atWordStart = i === 0 || wordBoundary.test(display[i - 1]);

      if (!atWordStart) {
        // Mark consecutive vowels for removal
        while (i < display.length && vowels.test(display[i])) {
          toRemove.add(i);
          i++;
        }
        continue;
      }
    }
    i++;
  }

  // Build result without removed characters
  return display
    .split('')
    .filter((_, idx) => !toRemove.has(idx))
    .join('');
}

export const BackendStatus = React.memo(({ agent }: BackendStatusProps) => {
  const [model, setModel] = useState<string>("");

  useEffect(() => {
    if (!agent) {
      return;
    }

    // Get initial value
    const initialModel = agent.getCurrentModel();
    setModel(initialModel);

    // Listen for model changes
    const handleModelChange = (data: { model: string }) => {
      setModel(data.model);
    };

    agent.on('modelChange', handleModelChange);

    // Cleanup listener on unmount
    return () => {
      agent.off('modelChange', handleModelChange);
    };
  }, [agent]);

  if (!agent) {
    return null;
  }

  const backend = agent.getBackend();
  let displayModel = model || agent.getCurrentModel();

  // Strip -cloud suffix from model name only if backend is ollama-cloud
  if (backend === 'ollama-cloud' && displayModel.includes('-cloud')) {
    displayModel = displayModel.replace('-cloud', '');
  }

  // Get bot name from environment
  const botName = process.env.ZDS_AI_AGENT_BOT_NAME;

  // Build backend/model part
  let backendModel = `${backend}/${displayModel}`;

  // Truncate backend/model if needed (accounting for botName if present)
  const maxBackendModelLength = botName ? 37 - botName.length : 38;
  backendModel = truncateBackendModel(backendModel, maxBackendModelLength);

  // Format: [botName:]backend/model
  const display = botName ? `${botName}:${backendModel}` : backendModel;

  return (
    <Box marginRight={2}>
      <Text color="yellow">
        ≋&nbsp;{display}
      </Text>
    </Box>
  );
});
