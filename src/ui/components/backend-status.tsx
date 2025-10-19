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

  // Get bot name from environment
  const botName = process.env.ZDS_AI_AGENT_BOT_NAME;

  // Format: [botName:]backend/model
  const display = botName ? `${botName}:${backend}/${model}` : `${backend}/${model}`;

  return (
    <Box marginRight={2}>
      <Text color="yellow">
        ≋ {display}
      </Text>
    </Box>
  );
});
