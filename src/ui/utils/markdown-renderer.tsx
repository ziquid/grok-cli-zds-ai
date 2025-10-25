import React from 'react';
import { Text } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

export function MarkdownRenderer({ content }: { content: string }) {
  try {
    // Create a new renderer with width reduced by 3 columns for each render
    // to account for bullet points and spacing that would cause wrapping
    const terminalWidth = (process.stdout.columns || 80) - 3;

    const renderer = new (TerminalRenderer as any)({
      width: terminalWidth,
      reflowText: true
    });

    marked.setOptions({ renderer });

    // Use marked.parse for synchronous parsing
    const result = marked.parse(content);
    // Handle both sync and async results
    const rendered = typeof result === 'string' ? result : content;
    return <Text>{rendered}</Text>;
  } catch (error) {
    // Fallback to plain text if markdown parsing fails
    console.error('Markdown rendering error:', error);
    return <Text>{content}</Text>;
  }
}