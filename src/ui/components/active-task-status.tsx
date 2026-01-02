import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { LLMAgent } from "../../agent/llm-agent.js";

interface ActiveTaskStatusProps {
  agent?: LLMAgent;
}

export const ActiveTaskStatus = React.memo(({ agent }: ActiveTaskStatusProps) => {
  const [activeTask, setActiveTask] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [color, setColor] = useState<string>("white");

  useEffect(() => {
    if (!agent) {
      return;
    }

    // Get initial value
    const initialTask = agent.getActiveTask();
    const initialAction = agent.getActiveTaskAction();
    const initialColor = agent.getActiveTaskColor();
    setActiveTask(initialTask);
    setAction(initialAction);
    setColor(initialColor);

    // Listen for task changes
    const handleTaskChange = (data: { activeTask: string; action: string; color: string }) => {
      setActiveTask(data.activeTask);
      setAction(data.action);
      setColor(data.color);
    };

    agent.on('activeTaskChange', handleTaskChange);

    // Cleanup listener on unmount
    return () => {
      agent.off('activeTaskChange', handleTaskChange);
    };
  }, [agent]);

  if (!agent || !activeTask) {
    return null;
  }

  const displayText = action ? `📋 ${action}: ${activeTask}` : `📋 ${activeTask}`;

  return (
    <Box marginLeft={1}>
      <Text color={color as any}>
        {displayText.substring(0, 50)}
      </Text>
    </Box>
  );
});
