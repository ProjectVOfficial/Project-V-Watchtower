export interface HtmlScriptBlock {
  openTag: string;
  body: string;
  closeTag: string;
}

function isHtmlSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

function findTagEnd(input: string, start: number): number {
  let quote = '';
  for (let index = start; index < input.length; index += 1) {
    const char = input[index]!;
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  return -1;
}

export function getHtmlTagAttribute(openTag: string, wantedName: string): string | null {
  const target = wantedName.toLowerCase();
  let index = openTag.indexOf(' ');
  if (index < 0) return null;

  while (index < openTag.length) {
    while (index < openTag.length && isHtmlSpace(openTag[index]!)) index += 1;
    if (index >= openTag.length || openTag[index] === '>' || openTag[index] === '/') break;

    const nameStart = index;
    while (
      index < openTag.length
      && !isHtmlSpace(openTag[index]!)
      && openTag[index] !== '='
      && openTag[index] !== '>'
      && openTag[index] !== '/'
    ) index += 1;
    const name = openTag.slice(nameStart, index).toLowerCase();

    while (index < openTag.length && isHtmlSpace(openTag[index]!)) index += 1;
    if (openTag[index] !== '=') {
      if (name === target) return '';
      continue;
    }
    index += 1;
    while (index < openTag.length && isHtmlSpace(openTag[index]!)) index += 1;

    const quote = openTag[index] === '"' || openTag[index] === "'" ? openTag[index]! : '';
    if (quote) index += 1;
    const valueStart = index;
    if (quote) {
      while (index < openTag.length && openTag[index] !== quote) index += 1;
    } else {
      while (
        index < openTag.length
        && !isHtmlSpace(openTag[index]!)
        && openTag[index] !== '>'
      ) index += 1;
    }
    const value = openTag.slice(valueStart, index);
    if (quote && openTag[index] === quote) index += 1;
    if (name === target) return value;
  }

  return null;
}

export function rewriteHtmlScriptBlocks(
  html: string,
  rewriter: (block: HtmlScriptBlock) => string,
): string {
  const input = String(html);
  const lower = input.toLowerCase();
  let output = '';
  let cursor = 0;

  while (cursor < input.length) {
    let open = lower.indexOf('<script', cursor);
    while (open !== -1) {
      const boundary = lower[open + 7] ?? '';
      if (!boundary || boundary === '>' || boundary === '/' || isHtmlSpace(boundary)) break;
      open = lower.indexOf('<script', open + 7);
    }

    if (open === -1) {
      output += input.slice(cursor);
      break;
    }

    output += input.slice(cursor, open);
    const openEnd = findTagEnd(input, open + 7);
    if (openEnd === -1) {
      output += input.slice(open);
      break;
    }

    const close = lower.indexOf('</script', openEnd + 1);
    if (close === -1) {
      output += input.slice(open);
      break;
    }
    const closeEnd = findTagEnd(input, close + 8);
    if (closeEnd === -1) {
      output += input.slice(open);
      break;
    }

    output += rewriter({
      openTag: input.slice(open, openEnd + 1),
      body: input.slice(openEnd + 1, close),
      closeTag: input.slice(close, closeEnd + 1),
    });
    cursor = closeEnd + 1;
  }

  return output;
}
