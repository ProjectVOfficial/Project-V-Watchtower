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
