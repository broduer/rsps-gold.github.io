import fs from "node:fs";
import path from "node:path";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const RAW_TEXT_ELEMENTS = new Set([
  "noscript",
  "script",
  "style",
  "template",
  "textarea",
  "title",
]);

const NAMED_ENTITIES = new Map(
  Object.entries({
    amp: "&",
    apos: "'",
    bull: "•",
    cent: "¢",
    copy: "©",
    euro: "€",
    gt: ">",
    hellip: "…",
    laquo: "«",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    middot: "·",
    nbsp: "\u00a0",
    ndash: "–",
    pound: "£",
    quot: '"',
    raquo: "»",
    rdquo: "”",
    reg: "®",
    rsquo: "’",
    times: "×",
    trade: "™",
    yen: "¥",
  }),
);

function comparePaths(left, right) {
  const naturalOrder = left.localeCompare(right, "en", {
    numeric: true,
    sensitivity: "base",
  });
  if (naturalOrder) return naturalOrder;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function findTagEnd(source, startOffset) {
  let quote = "";
  for (let index = startOffset; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index + 1;
  }
  return source.length;
}

export function scanHtmlTags(source) {
  const tokens = [];
  let cursor = 0;

  while (cursor < source.length) {
    const startOffset = source.indexOf("<", cursor);
    if (startOffset < 0) break;

    if (source.startsWith("<!--", startOffset)) {
      const commentEnd = source.indexOf("-->", startOffset + 4);
      cursor = commentEnd < 0 ? source.length : commentEnd + 3;
      continue;
    }

    const prefix = source.slice(startOffset, startOffset + 3);
    if (/^<![^-]/.test(prefix) || source.startsWith("<?", startOffset)) {
      cursor = findTagEnd(source, startOffset + 2);
      continue;
    }

    let nameStart = startOffset + 1;
    let closing = false;
    if (source[nameStart] === "/") {
      closing = true;
      nameStart += 1;
    }
    while (/\s/.test(source[nameStart] || "")) nameStart += 1;

    const nameMatch = source.slice(nameStart).match(/^[A-Za-z][\w:-]*/);
    if (!nameMatch) {
      cursor = startOffset + 1;
      continue;
    }

    const name = nameMatch[0].toLowerCase();
    const endOffset = findTagEnd(source, nameStart + nameMatch[0].length);
    const raw = source.slice(startOffset, endOffset);
    const selfClosing = !closing && /\/\s*>$/.test(raw);
    const token = {
      name,
      closing,
      selfClosing,
      startOffset,
      endOffset,
      raw,
      attributes: closing ? {} : parseAttributes(raw),
    };
    tokens.push(token);
    cursor = endOffset;

    if (!closing && !selfClosing && RAW_TEXT_ELEMENTS.has(name)) {
      const closingPattern = new RegExp(`</${name}\\s*>`, "gi");
      closingPattern.lastIndex = endOffset;
      const closingMatch = closingPattern.exec(source);
      if (!closingMatch) {
        cursor = source.length;
        continue;
      }
      tokens.push({
        name,
        closing: true,
        selfClosing: false,
        startOffset: closingMatch.index,
        endOffset: closingPattern.lastIndex,
        raw: closingMatch[0],
        attributes: {},
      });
      cursor = closingPattern.lastIndex;
    }
  }

  return tokens;
}

function pairHtmlElements(tokens) {
  const stack = [];
  const pairs = [];

  for (const token of tokens) {
    if (!token.closing) {
      if (!token.selfClosing && !VOID_ELEMENTS.has(token.name)) stack.push(token);
      continue;
    }

    let openingIndex = stack.length - 1;
    while (openingIndex >= 0 && stack[openingIndex].name !== token.name) {
      openingIndex -= 1;
    }
    if (openingIndex < 0) continue;

    const [open] = stack.splice(openingIndex, 1);
    pairs.push({
      name: open.name,
      attributes: open.attributes,
      open,
      close: token,
      startOffset: open.startOffset,
      endOffset: token.endOffset,
      contentStartOffset: open.endOffset,
      contentEndOffset: token.startOffset,
    });
  }

  return pairs.sort((left, right) => left.startOffset - right.startOffset);
}

function classNames(attributes) {
  return new Set(String(attributes.class || "").split(/\s+/).filter(Boolean));
}

function hasClass(attributes, expected) {
  return classNames(attributes).has(expected);
}

function makeLocator(source) {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") lineStarts.push(index + 1);
  }

  return (offset) => {
    const boundedOffset = Math.max(0, Math.min(Number(offset) || 0, source.length));
    let lower = 0;
    let upper = lineStarts.length;
    while (lower + 1 < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (lineStarts[middle] <= boundedOffset) lower = middle;
      else upper = middle;
    }
    return {
      offset: boundedOffset,
      line: lower + 1,
      column: boundedOffset - lineStarts[lower] + 1,
    };
  };
}

function makeRange(locator, startOffset, endOffset) {
  return {
    start: locator(startOffset),
    end: locator(endOffset),
  };
}

function decodeCodePoint(value, radix) {
  const codePoint = Number.parseInt(value, radix);
  if (
    !Number.isFinite(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return "�";
  }
  return String.fromCodePoint(codePoint);
}

function flattenJsonLdNodes(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value["@graph"])) return value["@graph"];
  return value && typeof value === "object" ? [value] : [];
}

function jsonErrorPosition(message) {
  const match = String(message).match(/(?:position|at position)\s+(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function decodeUrlPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Recursively discovers HTML files below rootDir and returns stable POSIX-style
 * paths relative to rootDir. Symbolic-link directories are intentionally not
 * followed, which keeps the inventory finite and deterministic.
 */
export function discoverHtmlFiles(rootDir) {
  const absoluteRoot = path.resolve(rootDir);
  const files = [];

  function walk(directory) {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => comparePaths(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        files.push(toPosixPath(path.relative(absoluteRoot, absolutePath)));
      }
    }
  }

  walk(absoluteRoot);
  return files.sort(comparePaths);
}

/**
 * Parses attributes from an opening tag (or a raw attribute fragment).
 * Attribute names are lower-cased and values are entity-decoded. Boolean
 * attributes have an empty-string value.
 */
export function parseAttributes(tagSource) {
  const source = String(tagSource || "");
  let cursor = 0;

  if (source.trimStart().startsWith("<")) {
    cursor = source.indexOf("<") + 1;
    if (source[cursor] === "/") cursor += 1;
    while (/\s/.test(source[cursor] || "")) cursor += 1;
    const tagName = source.slice(cursor).match(/^[A-Za-z][\w:-]*/)?.[0] || "";
    cursor += tagName.length;
  }

  const attributes = {};
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] || "")) cursor += 1;
    if (cursor >= source.length || source[cursor] === ">") break;
    if (source[cursor] === "/" && /^\/\s*>/.test(source.slice(cursor))) break;

    const nameMatch = source.slice(cursor).match(/^[^\s=/>]+/);
    if (!nameMatch) {
      cursor += 1;
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    cursor += nameMatch[0].length;
    while (/\s/.test(source[cursor] || "")) cursor += 1;

    let value = "";
    if (source[cursor] === "=") {
      cursor += 1;
      while (/\s/.test(source[cursor] || "")) cursor += 1;
      const quote = source[cursor];
      if (quote === '"' || quote === "'") {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < source.length && source[cursor] !== quote) cursor += 1;
        value = source.slice(valueStart, cursor);
        if (source[cursor] === quote) cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < source.length && !/[\s>]/.test(source[cursor])) cursor += 1;
        value = source.slice(valueStart, cursor);
      }
    }
    attributes[name] = decodeHtmlEntities(value);
  }

  return attributes;
}

/** Decodes numeric references and the common named entities used by the site. */
export function decodeHtmlEntities(value) {
  return String(value ?? "").replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z][\da-z]+));/gi,
    (match, decimal, hexadecimal, named) => {
      if (decimal) return decodeCodePoint(decimal, 10);
      if (hexadecimal) return decodeCodePoint(hexadecimal, 16);
      return NAMED_ENTITIES.get(named.toLowerCase()) ?? match;
    },
  );
}

/** Converts an HTML fragment to normalized visible plain text. */
export function toPlainText(html) {
  return decodeHtmlEntities(
    String(html ?? "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(
        /<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi,
        " ",
      )
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Parses every application/ld+json script without aborting on malformed JSON.
 * Each result includes the parsed value and flattened nodes, or a serializable
 * error, together with one-based line/column and zero-based offset ranges.
 */
export function parseJsonLdScripts(html, file = "") {
  const source = String(html ?? "");
  const locator = makeLocator(source);
  const pairs = pairHtmlElements(scanHtmlTags(source));
  const scripts = pairs.filter(
    (pair) =>
      pair.name === "script" &&
      String(pair.attributes.type || "").trim().toLowerCase() ===
        "application/ld+json",
  );

  return scripts.map((script, index) => {
    const raw = source.slice(script.contentStartOffset, script.contentEndOffset);
    const result = {
      index,
      file,
      attributes: script.attributes,
      raw,
      value: null,
      nodes: [],
      error: null,
      location: makeRange(locator, script.startOffset, script.endOffset),
      contentLocation: makeRange(
        locator,
        script.contentStartOffset,
        script.contentEndOffset,
      ),
    };

    try {
      result.value = JSON.parse(raw);
      result.nodes = flattenJsonLdNodes(result.value);
    } catch (error) {
      const relativeOffset = jsonErrorPosition(error.message);
      result.error = {
        name: error.name,
        message: error.message,
        location:
          relativeOffset === null
            ? result.contentLocation.start
            : locator(script.contentStartOffset + relativeOffset),
      };
    }
    return result;
  });
}

/**
 * Extracts visible FAQ questions and answers from both the shared guide FAQ
 * component and the simpler `.faq-list > details` component.
 */
export function extractVisibleFaqs(html, file = "") {
  const source = String(html ?? "");
  const locator = makeLocator(source);
  const pairs = pairHtmlElements(scanHtmlTags(source));
  const containers = pairs.filter(
    (pair) => hasClass(pair.attributes, "guide-faq") || hasClass(pair.attributes, "faq-list"),
  );
  const items = [];

  for (const container of containers) {
    const layout = hasClass(container.attributes, "guide-faq") ? "guide" : "simple";
    const details = pairs.filter(
      (pair) =>
        pair.name === "details" &&
        pair.startOffset >= container.contentStartOffset &&
        pair.endOffset <= container.contentEndOffset,
    );

    for (const detail of details) {
      const summary = pairs.find(
        (pair) =>
          pair.name === "summary" &&
          pair.startOffset >= detail.contentStartOffset &&
          pair.endOffset <= detail.contentEndOffset,
      );
      if (!summary) continue;

      const questionElement = pairs.find(
        (pair) =>
          hasClass(pair.attributes, "guide-faq__question") &&
          pair.startOffset >= summary.contentStartOffset &&
          pair.endOffset <= summary.contentEndOffset,
      );
      const answerElement = pairs.find(
        (pair) =>
          (hasClass(pair.attributes, "guide-faq__answer") ||
            hasClass(pair.attributes, "faq-answer")) &&
          pair.startOffset >= summary.endOffset &&
          pair.endOffset <= detail.contentEndOffset,
      );
      const questionStart = questionElement?.contentStartOffset ?? summary.contentStartOffset;
      const questionEnd = questionElement?.contentEndOffset ?? summary.contentEndOffset;
      const answerStart = answerElement?.contentStartOffset ?? summary.endOffset;
      const answerEnd = answerElement?.contentEndOffset ?? detail.contentEndOffset;

      items.push({
        index: items.length,
        file,
        layout,
        question: toPlainText(source.slice(questionStart, questionEnd)),
        answer: toPlainText(source.slice(answerStart, answerEnd)),
        location: makeRange(locator, detail.startOffset, detail.endOffset),
        questionLocation: makeRange(locator, questionStart, questionEnd),
        answerLocation: makeRange(locator, answerStart, answerEnd),
      });
    }
  }

  return items.sort(
    (left, right) => left.location.start.offset - right.location.start.offset,
  ).map((item, index) => ({ ...item, index }));
}

/** Extracts H1–H6 elements in source order with normalized visible text. */
export function extractHeadings(html, file = "") {
  const source = String(html ?? "");
  const locator = makeLocator(source);
  return pairHtmlElements(scanHtmlTags(source))
    .filter((pair) => /^h[1-6]$/.test(pair.name))
    .map((pair) => ({
      file,
      level: Number.parseInt(pair.name.slice(1), 10),
      text: toPlainText(source.slice(pair.contentStartOffset, pair.contentEndOffset)),
      html: source.slice(pair.contentStartOffset, pair.contentEndOffset),
      attributes: pair.attributes,
      location: makeRange(locator, pair.startOffset, pair.endOffset),
    }));
}

/** Extracts every explicit HTML id in source order, including duplicates. */
export function extractIds(html, file = "") {
  const source = String(html ?? "");
  const locator = makeLocator(source);
  return scanHtmlTags(source)
    .filter(
      (token) =>
        !token.closing && Object.prototype.hasOwnProperty.call(token.attributes, "id"),
    )
    .map((token) => ({
      file,
      id: token.attributes.id,
      tagName: token.name,
      location: makeRange(locator, token.startOffset, token.endOffset),
    }));
}

/**
 * Resolves a root-relative, document-relative, query-only or hash-only URL to
 * a site-relative path. External and non-navigation schemes return null.
 */
export function resolveLocalUrl(href, fromFile = "index.html", rootDir) {
  const rawHref = String(href ?? "").trim();
  if (!rawHref) return null;

  const normalizedFromFile = String(fromFile || "index.html")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const base = new URL(normalizedFromFile || "index.html", "https://local.invalid/");
  let url;
  try {
    url = new URL(rawHref, base);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;

  let relativePath = decodeUrlPart(url.pathname).replace(/^\/+/, "");
  if (!relativePath || url.pathname.endsWith("/")) {
    relativePath = `${relativePath.replace(/\/+$/, "")}${relativePath ? "/" : ""}index.html`;
  }
  relativePath = path.posix.normalize(relativePath);

  return {
    href: rawHref,
    file: relativePath,
    fragment: decodeUrlPart(url.hash.slice(1)),
    search: url.search,
    absolutePath: rootDir
      ? path.resolve(rootDir, ...relativePath.split("/"))
      : null,
  };
}
