import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { GrokAgent } from "../../agent/grok-agent";

interface MoodStatusProps {
  agent?: GrokAgent;
}

export function MoodStatus({ agent }: MoodStatusProps) {
  const [mood, setMood] = useState<string>("");
  const [color, setColor] = useState<string>("white");

  useEffect(() => {
    if (!agent) {
      return;
    }

    // Get initial value
    const initialMood = agent.getMood();
    const initialColor = agent.getMoodColor();
    setMood(initialMood);
    setColor(initialColor);

    // Listen for mood changes
    const handleMoodChange = (data: { mood: string; color: string }) => {
      setMood(data.mood);
      setColor(data.color);
    };

    agent.on('moodChange', handleMoodChange);

    // Cleanup listener on unmount
    return () => {
      agent.off('moodChange', handleMoodChange);
    };
  }, [agent]);

  if (!agent || !mood) {
    return null;
  }

  return (
    <Box marginLeft={1}>
      <Text color={color as any}>
        💭 {mood.substring(0, 10)}
      </Text>
    </Box>
  );
}
