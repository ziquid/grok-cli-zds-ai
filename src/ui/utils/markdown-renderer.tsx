import React from 'react';
import { Text } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

export function MarkdownRenderer({ content }: { content: string }) {
  try {
    // List of common abbreviations that should NOT get two spaces after them
    const abbreviations = ['Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Jr', 'Sr', 'Prof', 'Rev'];

    // Pre-process: Convert one or two spaces after hard stops to nbsp + space (to prevent reflow collapse)
    // Pattern: word(2+ chars) + optional quotes/markdown + hard stop + optional quotes/markdown + 1-2 spaces + optional quotes/markdown + capital
    // Supports: " ' " " ' ' " " (quotes) and * ** (markdown emphasis)
    // Note: nbsp comes FIRST so it stays with the hard stop, not at start of new line
    let processed = content.replace(/\b(\w{2,})(["'""''""\u201C\u201D*]*?)([.!?])(["'""''""\u201C\u201D*]*?) {1,2}(["'""''""\u201C\u201D*]*?)([A-Z])/g,
      (match, word, markupBefore, punct, markupAfter, markupBeforeCap, cap) => {
        // Don't convert if word is an abbreviation
        if (abbreviations.includes(word)) return match;
        // Convert to: non-breaking space + regular space (preserving all markup)
        return `${word}${markupBefore}${punct}${markupAfter}\u00A0 ${markupBeforeCap}${cap}`;
      }
    );

    // Create a new renderer with width reduced by 5 columns for each render
    // to account for bullet points and spacing that would cause wrapping
    const terminalWidth = (process.stdout.columns || 80) - 5;

    const renderer = new (TerminalRenderer as any)({
      width: terminalWidth,
      reflowText: true
    });

    marked.setOptions({ renderer });

    // Use marked.parse for synchronous parsing
    const result = marked.parse(processed);
    // Handle both sync and async results
    const rendered = typeof result === 'string' ? result : content;
    return <Text>{rendered}</Text>;
  } catch (error) {
    // Fallback to plain text if markdown parsing fails
    console.error('Markdown rendering error:', error);
    return <Text>{content}</Text>;
  }
}