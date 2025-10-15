import React from "react";
import { Box, Text } from "ink";
import { GrokAgent } from "../../agent/grok-agent.js";

interface BackendStatusProps {
  agent?: GrokAgent;
}

export const BackendStatus = React.memo(({ agent }: BackendStatusProps) => {
  if (!agent) {
    return null;
  }

  const backend = agent.getBackend();
  let model = agent.getCurrentModel();

  // Strip -cloud suffix from model name only if backend is ollama-cloud
  if (backend === 'ollama-cloud' && model.includes('-cloud')) {
    model = model.replace('-cloud', '');
  }

  // Format: backend/model
  const display = `${backend}/${model}`;

  return (
    <Box marginRight={2}>
      <Text color="yellow">
        ≋ {display}
      </Text>
    </Box>
  );
});
