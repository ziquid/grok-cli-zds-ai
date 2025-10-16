import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { formatTokenCount } from "../../utils/token-counter.js";

interface LoadingSpinnerProps {
  isActive: boolean;
  processingTime: number;
  tokenCount: number;
}

const loadingTexts = [
  "Thinking...",
  "Computing...",
  "Analyzing...",
  "Processing...",
  "Calculating...",
  "Interfacing...",
  "Optimizing...",
  "Synthesizing...",
  "Decrypting...",
  "Calibrating...",
  "Bootstrapping...",
  "Synchronizing...",
  "Compiling...",
  "Downloading...",
];

const spinnerFrames = ["/", "-", "\\", "|"];

export const LoadingSpinner = React.memo(({
  isActive,
  processingTime,
  tokenCount,
}: LoadingSpinnerProps) => {
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);

  useEffect(() => {
    if (!isActive) return;

    // Reduced frequency: 1000ms to reduce flickering
    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % spinnerFrames.length);
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;

    setLoadingTextIndex(Math.floor(Math.random() * loadingTexts.length));

    // Increased interval: 5s instead of 4s to reduce state changes
    const interval = setInterval(() => {
      setLoadingTextIndex(Math.floor(Math.random() * loadingTexts.length));
    }, 5000);

    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  return (
    <Box marginTop={1}>
      <Text color="cyan">
        {spinnerFrames[spinnerFrame]} {loadingTexts[loadingTextIndex]}{" "}
      </Text>
      <Text color="gray">
        ({processingTime}s · ↑ {formatTokenCount(tokenCount)} tokens · esc to
        interrupt)
      </Text>
    </Box>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  // Only re-render if props actually changed
  return (
    prevProps.isActive === nextProps.isActive &&
    prevProps.processingTime === nextProps.processingTime &&
    prevProps.tokenCount === nextProps.tokenCount
  );
});
