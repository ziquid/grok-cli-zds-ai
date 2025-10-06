/**
 * Professional diff renderer component
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../utils/colors.js';
import crypto from 'crypto';
import { colorizeCode } from '../utils/code-colorizer.js';
import { MaxSizedBox } from '../shared/max-sized-box.js';

interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'other';
  oldLine?: number;
  newLine?: number;
  content: string;
}

function parseDiffWithLineNumbers(diffContent: string): DiffLine[] {
  const lines = diffContent.split('\n');
  const result: DiffLine[] = [];
  let currentOldLine = 0;
  let currentNewLine = 0;
  let inHunk = false;
  const hunkHeaderRegex = /^@@ -(\d+),?\d* \+(\d+),?\d* @@/;

  for (const line of lines) {
    const hunkMatch = line.match(hunkHeaderRegex);
    if (hunkMatch) {
      currentOldLine = parseInt(hunkMatch[1], 10);
      currentNewLine = parseInt(hunkMatch[2], 10);
      inHunk = true;
      result.push({ type: 'hunk', content: line });
      // We need to adjust the starting point because the first line number applies to the *first* actual line change/context,
      // but we increment *before* pushing that line. So decrement here.
      currentOldLine--;
      currentNewLine--;
      continue;
    }
    if (!inHunk) {
      // Skip standard Git header lines more robustly
      if (
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('similarity index') ||
        line.startsWith('rename from') ||
        line.startsWith('rename to') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode')
      )
        continue;
      // If it's not a hunk or header, skip (or handle as 'other' if needed)
      continue;
    }
    if (line.startsWith('+')) {
      currentNewLine++; // Increment before pushing
      result.push({
        type: 'add',
        newLine: currentNewLine,
        content: line.substring(1),
      });
    } else if (line.startsWith('-')) {
      currentOldLine++; // Increment before pushing
      result.push({
        type: 'del',
        oldLine: currentOldLine,
        content: line.substring(1),
      });
    } else if (line.startsWith(' ')) {
      currentOldLine++; // Increment before pushing
      currentNewLine++;
      result.push({
        type: 'context',
        oldLine: currentOldLine,
        newLine: currentNewLine,
        content: line.substring(1),
      });
    } else if (line.startsWith('\\')) {
      // Handle "\ No newline at end of file"
      result.push({ type: 'other', content: line });
    }
  }
  return result;
}

interface DiffRendererProps {
  diffContent: string;
  filename?: string;
  tabWidth?: number;
  availableTerminalHeight?: number;
  terminalWidth?: number;
}

const DEFAULT_TAB_WIDTH = 4; // Spaces per tab for normalization

export const DiffRenderer = ({
  diffContent,
  filename,
  tabWidth = DEFAULT_TAB_WIDTH,
  availableTerminalHeight,
  terminalWidth = 80,
}: DiffRendererProps): React.ReactElement => {
  if (!diffContent || typeof diffContent !== 'string') {
    return <Text color={Colors.AccentYellow}>No diff content.</Text>;
  }

  // Strip the first summary line (e.g. "Updated file.txt with 1 addition and 2 removals")
  const lines = diffContent.split('\n');
  const firstLine = lines[0];
  let actualDiffContent = diffContent;
  
  if (firstLine && (firstLine.startsWith('Updated ') || firstLine.startsWith('Created '))) {
    actualDiffContent = lines.slice(1).join('\n');
  }
  
  const parsedLines = parseDiffWithLineNumbers(actualDiffContent);

  if (parsedLines.length === 0) {
    return <Text dimColor>No changes detected.</Text>;
  }

  // Always render as diff format to show line numbers and + signs
  const renderedOutput = renderDiffContent(
    parsedLines,
    filename,
    tabWidth,
    availableTerminalHeight,
    terminalWidth,
  );

  return <>{renderedOutput}</>;
};

const renderDiffContent = (
  parsedLines: DiffLine[],
  filename: string | undefined,
  tabWidth = DEFAULT_TAB_WIDTH,
  availableTerminalHeight: number | undefined,
  terminalWidth: number,
) => {
  // 1. Normalize whitespace (replace tabs with spaces) *before* further processing
  const normalizedLines = parsedLines.map((line) => ({
    ...line,
    content: line.content.replace(/\t/g, ' '.repeat(tabWidth)),
  }));

  // Filter out non-displayable lines (hunks, potentially 'other') using the normalized list
  const displayableLines = normalizedLines.filter(
    (l) => l.type !== 'hunk' && l.type !== 'other',
  );

  if (displayableLines.length === 0) {
    return <Text dimColor>No changes detected.</Text>;
  }

  // Calculate the minimum indentation across all displayable lines
  let baseIndentation = Infinity; // Start high to find the minimum
  for (const line of displayableLines) {
    // Only consider lines with actual content for indentation calculation
    if (line.content.trim() === '') continue;

    const firstCharIndex = line.content.search(/\S/); // Find index of first non-whitespace char
    const currentIndent = firstCharIndex === -1 ? 0 : firstCharIndex; // Indent is 0 if no non-whitespace found
    baseIndentation = Math.min(baseIndentation, currentIndent);
  }
  // If baseIndentation remained Infinity (e.g., no displayable lines with content), default to 0
  if (!isFinite(baseIndentation)) {
    baseIndentation = 0;
  }

  const key = filename
    ? `diff-box-${filename}`
    : `diff-box-${crypto.createHash('sha1').update(JSON.stringify(parsedLines)).digest('hex')}`;

  let lastLineNumber: number | null = null;
  const MAX_CONTEXT_LINES_WITHOUT_GAP = 5;

  return (
    <MaxSizedBox
      maxHeight={availableTerminalHeight}
      maxWidth={terminalWidth}
      key={key}
    >
      {displayableLines.reduce<React.ReactNode[]>((acc, line, index) => {
        // Determine the relevant line number for gap calculation based on type
        let relevantLineNumberForGapCalc: number | null = null;
        if (line.type === 'add' || line.type === 'context') {
          relevantLineNumberForGapCalc = line.newLine ?? null;
        } else if (line.type === 'del') {
          // For deletions, the gap is typically in relation to the original file's line numbering
          relevantLineNumberForGapCalc = line.oldLine ?? null;
        }

        if (
          lastLineNumber !== null &&
          relevantLineNumberForGapCalc !== null &&
          relevantLineNumberForGapCalc >
            lastLineNumber + MAX_CONTEXT_LINES_WITHOUT_GAP + 1
        ) {
          acc.push(
            <Box key={`gap-${index}`}>
              <Text wrap="truncate">{'═'.repeat(terminalWidth)}</Text>
            </Box>,
          );
        }

        const lineKey = `diff-line-${index}`;
        let gutterNumStr = '';
        let backgroundColor: string | undefined = undefined;
        let prefixSymbol = ' ';
        let dim = false;

        switch (line.type) {
          case 'add':
            gutterNumStr = (line.newLine ?? '').toString();
            backgroundColor = '#86efac'; // Light green for additions
            prefixSymbol = '+';
            lastLineNumber = line.newLine ?? null;
            break;
          case 'del':
            gutterNumStr = (line.oldLine ?? '').toString();
            backgroundColor = 'redBright'; // Light red for deletions
            prefixSymbol = '-';
            // For deletions, update lastLineNumber based on oldLine if it's advancing.
            // This helps manage gaps correctly if there are multiple consecutive deletions
            // or if a deletion is followed by a context line far away in the original file.
            if (line.oldLine !== undefined) {
              lastLineNumber = line.oldLine;
            }
            break;
          case 'context':
            gutterNumStr = (line.newLine ?? '').toString();
            dim = true;
            prefixSymbol = ' ';
            lastLineNumber = line.newLine ?? null;
            break;
          default:
            return acc;
        }

        const displayContent = line.content.substring(baseIndentation);

        acc.push(
          <Box key={lineKey} flexDirection="row">
            <Text color={Colors.Gray} dimColor={dim}>{gutterNumStr.padEnd(4)}</Text>
            <Text color={backgroundColor ? '#000000' : undefined} backgroundColor={backgroundColor} dimColor={!backgroundColor && dim}>{prefixSymbol} </Text>
            <Text color={backgroundColor ? '#000000' : undefined} backgroundColor={backgroundColor} dimColor={!backgroundColor && dim} wrap="wrap">
              {displayContent}
            </Text>
          </Box>,
        );
        return acc;
      }, [])}
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