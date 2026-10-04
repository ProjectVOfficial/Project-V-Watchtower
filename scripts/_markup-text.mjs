/**
 * Convert markup-like input to plain text without relying on tag-filtering regexes.
 *
 * This is intentionally a small tokenizer, not an HTML sanitizer. Callers use it
 * only when they need text content from external HTML/XML before separately
 * decoding entities or validating structured fields.
 */
export function stripMarkupText(value, { brToNewline = false } = {}) {
  const input = String(value ?? '');
  let output = '';
  let index = 0;

  while (index < input.length) {
    if (input.startsWith('<![CDATA[', index)) {
      const end = input.indexOf(']]>', index + 9);
      if (end === -1) {
        output += input.slice(index + 9);
        break;
      }
      output += input.slice(index + 9, end);
      index = end + 3;
      continue;
    }

    if (input[index] !== '<') {
      output += input[index];
      index += 1;
      continue;
    }

    let cursor = index + 1;
    let quote = '';
    while (cursor < input.length) {
      const char = input[cursor];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        break;
      }
      cursor += 1;
    }

    if (cursor >= input.length) {
      // Treat an unmatched "<" as text rather than silently deleting the tail.
      output += input.slice(index);
      break;
    }

    if (brToNewline) {
      const tag = input.slice(index + 1, cursor).trim().toLowerCase();
      if (tag === 'br' || tag === 'br/' || tag.startsWith('br ') || tag.startsWith('br/')) {
        output += '\n';
      }
    }

    index = cursor + 1;
  }

  return output;
}


export function removeMarkupComments(value) {
  const input = String(value ?? '');
  let output = '';
  let index = 0;

  while (index < input.length) {
    const start = input.indexOf('<!--', index);
    if (start === -1) {
      output += input.slice(index);
      break;
    }
    output += input.slice(index, start);
    const end = input.indexOf('-->', start + 4);
    if (end === -1) break;
    index = end + 3;
  }

  return output;
}


function findTagEnd(input, start) {
  let quote = '';
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
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

export function removeMarkupBlocks(value, tagNames) {
  let output = String(value ?? '');
  for (const rawName of tagNames) {
    const name = String(rawName).toLowerCase();
    if (!name || [...name].some((char) => !/[a-z0-9-]/.test(char))) continue;

    let searchFrom = 0;
    while (searchFrom < output.length) {
      const lower = output.toLowerCase();
      const open = lower.indexOf('<' + name, searchFrom);
      if (open === -1) break;

      const boundary = lower[open + name.length + 1] ?? '';
      if (boundary && boundary !== '>' && boundary !== '/' && !/\s/.test(boundary)) {
        searchFrom = open + name.length + 1;
        continue;
      }

      const openEnd = findTagEnd(output, open + name.length + 1);
      if (openEnd === -1) {
        output = output.slice(0, open);
        break;
      }

      const close = lower.indexOf('</' + name, openEnd + 1);
      if (close === -1) {
        output = output.slice(0, open) + output.slice(openEnd + 1);
        searchFrom = open;
        continue;
      }

      const closeEnd = findTagEnd(output, close + name.length + 2);
      if (closeEnd === -1) {
        output = output.slice(0, open);
        break;
      }

      output = output.slice(0, open) + output.slice(closeEnd + 1);
      searchFrom = open;
    }
  }
  return output;
}
