export const YAML_INDENT = '  ';

export type YamlEditResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

function lineStart(text: string, index: number): number {
  const prev = text.lastIndexOf('\n', index - 1);
  return prev === -1 ? 0 : prev + 1;
}

function lineEnd(text: string, index: number): number {
  const next = text.indexOf('\n', index);
  return next === -1 ? text.length : next;
}

function unindentLine(line: string): { line: string; removed: number } {
  if (line.startsWith(YAML_INDENT)) {
    return { line: line.slice(YAML_INDENT.length), removed: YAML_INDENT.length };
  }
  if (line.startsWith('\t')) {
    return { line: line.slice(1), removed: 1 };
  }
  if (line.startsWith(' ')) {
    return { line: line.slice(1), removed: 1 };
  }
  return { line, removed: 0 };
}

function indentSelection(value: string, start: number, end: number): YamlEditResult {
  if (start === end) {
    const next = value.slice(0, start) + YAML_INDENT + value.slice(end);
    const pos = start + YAML_INDENT.length;
    return { value: next, selectionStart: pos, selectionEnd: pos };
  }

  const blockStart = lineStart(value, start);
  const blockEnd = lineEnd(value, end);
  const lines = value.slice(blockStart, blockEnd).split('\n');
  const indented = lines.map((line) => YAML_INDENT + line).join('\n');
  const next = value.slice(0, blockStart) + indented + value.slice(blockEnd);

  return {
    value: next,
    selectionStart: start + YAML_INDENT.length,
    selectionEnd: end + YAML_INDENT.length * lines.length,
  };
}

function unindentSelection(value: string, start: number, end: number): YamlEditResult {
  const blockStart = lineStart(value, start);
  const blockEnd = lineEnd(value, end);
  const lines = value.slice(blockStart, blockEnd).split('\n');

  let removedBeforeStart = 0;
  let removedBeforeEnd = 0;

  const dedentedLines = lines.map((line, index) => {
    const { line: nextLine, removed } = unindentLine(line);
    if (index === 0) {
      removedBeforeStart = Math.min(removed, start - blockStart);
    }
    removedBeforeEnd += removed;
    return nextLine;
  });

  const dedented = dedentedLines.join('\n');
  const next = value.slice(0, blockStart) + dedented + value.slice(blockEnd);

  if (start === end) {
    const pos = Math.max(blockStart, start - removedBeforeStart);
    return { value: next, selectionStart: pos, selectionEnd: pos };
  }

  return {
    value: next,
    selectionStart: Math.max(blockStart, start - removedBeforeStart),
    selectionEnd: Math.max(blockStart, end - removedBeforeEnd),
  };
}

function insertNewline(value: string, start: number, end: number): YamlEditResult {
  const currentLineStart = lineStart(value, start);
  const currentLine = value.slice(currentLineStart, lineEnd(value, start));
  const baseIndent = currentLine.match(/^(\s*)/)?.[1] ?? '';
  const extraIndent = currentLine.trimEnd().endsWith(':') ? YAML_INDENT : '';
  const insert = `\n${baseIndent}${extraIndent}`;

  const next = value.slice(0, start) + insert + value.slice(end);
  const pos = start + insert.length;
  return { value: next, selectionStart: pos, selectionEnd: pos };
}

export function applyYamlEditorKey(
  key: string,
  shiftKey: boolean,
  value: string,
  selectionStart: number,
  selectionEnd: number,
): YamlEditResult | null {
  if (key === 'Tab') {
    return shiftKey
      ? unindentSelection(value, selectionStart, selectionEnd)
      : indentSelection(value, selectionStart, selectionEnd);
  }

  if (key === 'Enter') {
    return insertNewline(value, selectionStart, selectionEnd);
  }

  return null;
}
