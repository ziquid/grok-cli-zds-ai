import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { GrokAgent } from "../../agent/grok-agent";

interface ContextStatusProps {
  agent?: GrokAgent;
}

export function ContextStatus({ agent }: ContextStatusProps) {
  const [contextUsage, setContextUsage] = useState<number>(0);

  useEffect(() => {
    if (!agent) {
      return;
    }

    // Get initial value
    setContextUsage(agent.getContextUsagePercent());

    // Listen for context changes
    const handleContextChange = (data: { current: number; max: number; percent: number }) => {
      setContextUsage(data.percent);
    };

    agent.on('contextChange', handleContextChange);

    // Cleanup listener on unmount
    return () => {
      agent.off('contextChange', handleContextChange);
    };
  }, [agent]);

  if (!agent || contextUsage < 80) {
    return null;
  }

  // Determine color based on usage percentage
  const getContextColor = (percent: number) => {
    if (percent >= 90) return "red";
    return "yellow";
  };

  return (
    <Box marginLeft={1}>
      <Text color={getContextColor(contextUsage)}>
        🧠 {Math.round(contextUsage)}% full
      </Text>
    </Box>
  );
}
