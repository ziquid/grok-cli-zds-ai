import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { GrokAgent } from "../../agent/grok-agent.js";

interface PersonaStatusProps {
  agent?: GrokAgent;
}

export const PersonaStatus = React.memo(({ agent }: PersonaStatusProps) => {
  const [persona, setPersona] = useState<string>("");
  const [color, setColor] = useState<string>("white");

  useEffect(() => {
    if (!agent) {
      return;
    }

    // Get initial value
    const initialPersona = agent.getPersona();
    const initialColor = agent.getPersonaColor();
    setPersona(initialPersona);
    setColor(initialColor);

    // Listen for persona changes
    const handlePersonaChange = (data: { persona: string; color: string }) => {
      setPersona(data.persona);
      setColor(data.color);
    };

    agent.on('personaChange', handlePersonaChange);

    // Cleanup listener on unmount
    return () => {
      agent.off('personaChange', handlePersonaChange);
    };
  }, [agent]);

  if (!agent || !persona) {
    return null;
  }

  return (
    <Box marginLeft={1}>
      <Text color={color as any}>
        🎭 {persona.substring(0, 20)}
      </Text>
    </Box>
  );
});
