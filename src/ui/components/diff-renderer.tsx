/**
 * Professional diff renderer component
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../utils/colors';
import { MaxSizedBox } from '../shared/max-sized-box';

interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'other';
  oldLine?: number;
  newLine?: number;
  content: string;
}

// Memoized parsing function to avoid re-parsing on every render
const parseDiffWithLineNumbers = (diffContent: string): DiffLine[] => {
  const lines = diffContent.split('\n');
  const result: DiffLine[] = [];
  let currentOldLine = 0;
  let currentNewLine = 0;
  let inHunk = false;
  const hunkHeaderRegex = /^@@ -(\d+),?\d* \+(\d+),?\d* @@/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hunkMatch = line.match(hunkHeaderRegex);
    
    if (hunkMatch) {
      currentOldLine = parseInt(hunkMatch[1], 10);
      currentNewLine = parseInt(hunkMatch[2], 10);
      inHunk = true;
      result.push({ type: 'hunk', content: line });
      currentOldLine--;
      currentNewLine--;
      continue;
    }
    
    if (!inHunk) {
      // Skip standard Git header lines more efficiently
      const firstChar = line[0];
      if (firstChar === '-' || firstChar === '+' || firstChar === 'd' || 
          firstChar === 'i' || firstChar === 's' || firstChar === 'r' || 
          firstChar === 'n') {
        const skipPrefixes = ['--- ', '+++ ', 'diff --git', 'index ', 'similarity index', 'rename from', 'rename to', 'new file mode', 'deleted file mode'];
        if (skipPrefixes.some(prefix => line.startsWith(prefix))) {
          continue;
        }
      }
      continue;
    }
    
    const firstChar = line[0];
    if (firstChar === '+') {
      currentNewLine++;
      result.push({
        type: 'add',
        newLine: currentNewLine,
        content: line.substring(1),
      });
    } else if (firstChar === '-') {
      currentOldLine++;
      result.push({
        type: 'del',
        oldLine: currentOldLine,
        content: line.substring(1),
      });
    } else if (firstChar === ' ') {
      currentOldLine++;
      currentNewLine++;
      result.push({
        type: 'context',
        oldLine: currentOldLine,
        newLine: currentNewLine,
        content: line.substring(1),
      });
    } else if (firstChar === '\\') {
      result.push({ type: 'other', content: line });
    }
  }
  return result;
};

interface DiffRendererProps {
  diffContent: string;
  filename?: string;
  tabWidth?: number;
  availableTerminalHeight?: number;
  terminalWidth?: number;
}

const DEFAULT_TAB_WIDTH = 4; // Spaces per tab for normalization

export const DiffRenderer = React.memo(({
  diffContent,
  filename,
  tabWidth = DEFAULT_TAB_WIDTH,
  availableTerminalHeight,
  terminalWidth = 80,
}: DiffRendererProps): React.ReactElement => {
  // Memoize all expensive computations
  const { actualDiffContent, parsedLines } = useMemo(() => {
    if (!diffContent || typeof diffContent !== 'string') {
      return { actualDiffContent: '', parsedLines: [] };
    }

    // Strip the first summary line efficiently
    const lines = diffContent.split('\n');
    const firstLine = lines[0];
    let content = diffContent;
    
    if (firstLine && (firstLine.startsWith('Updated ') || firstLine.startsWith('Created '))) {
      content = lines.slice(1).join('\n');
    }
    
    const parsed = parseDiffWithLineNumbers(content);
    return { actualDiffContent: content, parsedLines: parsed };
  }, [diffContent]);

  // Early returns for edge cases
  if (!diffContent || typeof diffContent !== 'string') {
    return <Text color={Colors.AccentYellow}>No diff content.</Text>;
  }

  if (parsedLines.length === 0) {
    return <Text dimColor>No changes detected.</Text>;
  }

  // Memoize the rendered output
  const renderedOutput = useMemo(
    () => renderDiffContent(
      parsedLines,
      filename,
      tabWidth,
      availableTerminalHeight,
      terminalWidth,
    ),
    [parsedLines, filename, tabWidth, availableTerminalHeight, terminalWidth]
  );

  return <>{renderedOutput}</>;
});

DiffRenderer.displayName = 'DiffRenderer';

const renderDiffContent = (
  parsedLines: DiffLine[],
  filename: string | undefined,
  tabWidth = DEFAULT_TAB_WIDTH,
  availableTerminalHeight: number | undefined,
  terminalWidth: number,
) => {
  // Process lines in a single pass to avoid multiple array operations
  const displayableLines: DiffLine[] = [];
  let baseIndentation = Infinity;
  const tabReplacement = ' '.repeat(tabWidth);
  
  // Single pass: filter, normalize, and calculate base indentation
  for (let i = 0; i < parsedLines.length; i++) {
    const line = parsedLines[i];
    
    // Skip non-displayable lines
    if (line.type === 'hunk' || line.type === 'other') {
      continue;
    }
    
    // Normalize tabs to spaces
    const normalizedContent = line.content.replace(/\t/g, tabReplacement);
    const normalizedLine = { ...line, content: normalizedContent };
    displayableLines.push(normalizedLine);
    
    // Calculate indentation in the same pass
    if (normalizedContent.trim() === '') continue;
    const firstCharIndex = normalizedContent.search(/\S/);
    const currentIndent = firstCharIndex === -1 ? 0 : firstCharIndex;
    baseIndentation = Math.min(baseIndentation, currentIndent);
  }

  if (displayableLines.length === 0) {
    return <Text dimColor>No changes detected.</Text>;
  }

  // Default base indentation if no content lines found
  if (!isFinite(baseIndentation)) {
    baseIndentation = 0;
  }

  // Use a simple key based on filename and length to avoid expensive hashing
  const key = filename ? `diff-${filename}-${displayableLines.length}` : `diff-${displayableLines.length}`;
  
  let lastLineNumber: number | null = null;
  const MAX_CONTEXT_LINES_WITHOUT_GAP = 5;

  // Pre-build rendered lines to avoid reduce operation
  const renderedLines: React.ReactNode[] = [];
  
  for (let index = 0; index < displayableLines.length; index++) {
    const line = displayableLines[index];
    
    // Determine the relevant line number for gap calculation based on type
    let relevantLineNumberForGapCalc: number | null = null;
    if (line.type === 'add' || line.type === 'context') {
      relevantLineNumberForGapCalc = line.newLine ?? null;
    } else if (line.type === 'del') {
      relevantLineNumberForGapCalc = line.oldLine ?? null;
    }

    // Add gap separator if needed
    if (
      lastLineNumber !== null &&
      relevantLineNumberForGapCalc !== null &&
      relevantLineNumberForGapCalc > lastLineNumber + MAX_CONTEXT_LINES_WITHOUT_GAP + 1
    ) {
      renderedLines.push(
        <Box key={`gap-${index}`}>
          <Text wrap="truncate">{'═'.repeat(Math.min(terminalWidth, 80))}</Text>
        </Box>
      );
    }

    // Prepare line rendering data
    let gutterNumStr = '';
    let backgroundColor: string | undefined = undefined;
    let prefixSymbol = ' ';
    let dim = false;

    if (line.type === 'add') {
      gutterNumStr = (line.newLine ?? '').toString();
      backgroundColor = '#86efac';
      prefixSymbol = '+';
      lastLineNumber = line.newLine ?? null;
    } else if (line.type === 'del') {
      gutterNumStr = (line.oldLine ?? '').toString();
      backgroundColor = 'redBright';
      prefixSymbol = '-';
      if (line.oldLine !== undefined) {
        lastLineNumber = line.oldLine;
      }
    } else if (line.type === 'context') {
      gutterNumStr = (line.newLine ?? '').toString();
      dim = true;
      prefixSymbol = ' ';
      lastLineNumber = line.newLine ?? null;
    }

    const displayContent = line.content.substring(baseIndentation);
    const lineKey = `diff-line-${index}`;

    renderedLines.push(
      <Box key={lineKey} flexDirection="row">
        <Text color={Colors.Gray} dimColor={dim}>
          {gutterNumStr.padEnd(4)}
        </Text>
        <Text 
          color={backgroundColor ? '#000000' : undefined} 
          backgroundColor={backgroundColor} 
          dimColor={!backgroundColor && dim}
        >
          {prefixSymbol} 
        </Text>
        <Text 
          color={backgroundColor ? '#000000' : undefined} 
          backgroundColor={backgroundColor} 
          dimColor={!backgroundColor && dim} 
          wrap="wrap"
        >
          {displayContent}
        </Text>
      </Box>
    );
  }

  return (
    <MaxSizedBox
      maxHeight={availableTerminalHeight}
      maxWidth={terminalWidth}
      key={key}
    >
      {renderedLines}
    </MaxSizedBox>
  );
};


const getLanguageFromExtension = (extension: string): string | null => {
  const languageMap: { [key: string]: string } = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    json: 'json',
    css: 'css',
    html: 'html',
    sh: 'bash',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    txt: 'plaintext',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    rb: 'ruby',
  };
  return languageMap[extension] || null; // Return null if extension not found
};