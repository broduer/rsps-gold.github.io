export const CSS_BLOCKS = Object.freeze([
  {
    key: "roat-pkz-money-making",
    start: "/* Roat Pkz money-making guide */",
    end: "\n* {",
  },
  {
    key: "impact-donator-ranks",
    start: "/* Impact Donator rank guide */",
    end: "/* Impact money-making guide */",
  },
  {
    key: "impact-money-making",
    start: "/* Impact money-making guide */",
    end: "/* Progressive mobile navigation for legacy site headers */",
  },
  {
    key: "impact-slayer",
    start: "/* Impact Slayer progression guide */",
    end: "/* Impact Hunter 1–99 guide */",
  },
  {
    key: "impact-hunter",
    start: "/* Impact Hunter 1–99 guide */",
    end: "/* Impact Thieving 1–99 guide */",
  },
  {
    key: "impact-thieving",
    start: "/* Impact Thieving 1–99 guide */",
    end: "/* Roat Pkz starter guide */",
  },
  {
    key: "roat-pkz-starter",
    start: "/* Roat Pkz starter guide */",
    end: "/* Roat Pkz Donator ranks guide */",
  },
  {
    key: "roat-pkz-donator-ranks",
    start: "/* Roat Pkz Donator ranks guide */",
    end: "/* Shared guide header positioning and context */",
  },
  {
    key: "payment-options",
    start: "/* Compact homepage payment options */",
    end: null,
  },
].map((block) => Object.freeze(block)));

export const COMMERCIAL_CSS_RANGE = Object.freeze({
  key: "commercial-range",
  start: ".server-hero-card,\n.rate-card {",
  end: "/* Guide hub and long-form article layout */",
});

function isPreservedBundleComment(comment) {
  return /^\/\*!/.test(comment) ||
    /^\/\* Page (?:stylesheet|runtime): /.test(comment);
}

export function minifyCss(source) {
  const input = String(source).replace(/\r\n?/g, "\n");
  let output = "";
  let quote = "";
  let escaped = false;
  let pendingSpace = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (quote) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      if (pendingSpace && output && !/[{}:;,>~(]$/.test(output)) output += " ";
      pendingSpace = false;
      quote = character;
      output += character;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = input.indexOf("*/", index + 2);
      if (end < 0) throw new Error("Unterminated CSS comment");
      const comment = input.slice(index, end + 2);
      if (isPreservedBundleComment(comment)) {
        output = output.replace(/[ \t]+$/g, "");
        if (output && !output.endsWith("\n")) output += "\n";
        output += `${comment}\n`;
        pendingSpace = false;
      } else {
        pendingSpace = true;
      }
      index = end + 1;
      continue;
    }
    if (/\s/.test(character)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && output &&
        !/[{}:;,>~(\n]$/.test(output) && !/[{}:;,>~)]/.test(character)) {
      output += " ";
    }
    pendingSpace = false;
    output += character;
  }
  if (quote) throw new Error("Unterminated CSS string");
  return output.trim();
}

// JavaScript whitespace is syntactic around ASI, regex literals and template
// expressions. Removing only indentation outside strings/templates is less
// aggressive than a parser-backed minifier, but is deterministic and safe.
export function minifyJavaScript(source) {
  const input = String(source).replace(/\r\n?/g, "\n");
  let output = "";
  let template = false;
  let escaped = false;
  let lineStart = true;
  for (const character of input) {
    if (!template && lineStart && (character === " " || character === "\t")) continue;
    output += character;
    if (template) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "`") template = false;
    } else if (character === "`") {
      template = true;
    }
    lineStart = character === "\n";
  }
  if (template) throw new Error("Unterminated JavaScript template literal");
  return output.trim();
}

const JS_FEATURES = {
  "impact-rank-calculator": ["initImpactRankCalculator"],
  "impact-profit-calculator": ["initImpactProfitCalculator"],
  "impact-slayer-tier-helper": ["initImpactSlayerTierHelper"],
  "impact-slayer-directory": ["initImpactSlayerDirectory"],
  "impact-hunter-planner": ["initImpactHunterPlanner"],
  "impact-thieving-planner": ["initImpactThievingPlanner"],
  "roat-pkz-command-directory": ["initRoatCommandDirectory"],
  "roat-pkz-method-finder": ["initRoatMoneyMakingGuide"],
  "roat-pkz-profit-calculator": ["initRoatMoneyMakingGuide"],
  "roat-pkz-rank-finder": ["initRoatDonatorRankFinder"],
};

const FEATURE_FUNCTIONS = [
  "initImpactRankCalculator",
  "initImpactProfitCalculator",
  "initImpactSlayerTierHelper",
  "initImpactSlayerDirectory",
  "initImpactHunterPlanner",
  "initImpactThievingPlanner",
  "initRoatCommandDirectory",
  "initRoatMoneyMakingGuide",
  "initRoatDonatorRankFinder",
];

function removeDelimitedBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing bundle start marker: ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  if (end < 0) throw new Error(`Missing bundle end marker: ${endMarker}`);
  return source.slice(0, start) + source.slice(end);
}

function extractDelimitedBlock(source, startMarker, endMarker, searchFrom = 0) {
  const start = source.indexOf(startMarker, searchFrom);
  if (start < 0) throw new Error(`Missing shared CSS start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Missing shared CSS end marker: ${endMarker}`);
  return { css: source.slice(start, end), start };
}

function extractSharedMoneyCalculatorCss(source) {
  const featureStart = source.indexOf("/* Impact money-making guide */");
  if (featureStart < 0) throw new Error("Missing Impact money-making CSS marker");
  const calculator = extractDelimitedBlock(
    source,
    ".money-calculator {",
    "\n.money-measure {",
    featureStart,
  );
  const tablet = extractDelimitedBlock(
    source,
    "@media (max-width: 760px) {",
    "@media (max-width: 600px) {",
    calculator.start,
  );
  const mobile = extractDelimitedBlock(
    source,
    "@media (max-width: 600px) {",
    "/* Progressive mobile navigation for legacy site headers */",
    tablet.start,
  );
  return [calculator.css, tablet.css, mobile.css].join("\n\n");
}

function isCommercialFamily(family) {
  return family === "home" || family.startsWith("commercial-");
}

function rewriteCssAssetUrls(source) {
  return source
    .replace(/url\((['"]?)assets\//g, "url($1/assets/")
    .replace(
      /assets\/rsps-adventure-background\.png/g,
      "assets/rsps-adventure-background.webp",
    )
    .replace(
      /assets\/images\/wide_bright_medieval_fantasy_runescape_style_vill\.png/g,
      "assets/images/wide_bright_medieval_fantasy_runescape_style_vill.webp",
    );
}

export function createPageCss(globalCss, page, inlineCss = "") {
  const normalizedGlobalCss = String(globalCss).replace(/\r\n?/g, "\n");
  let bundled = normalizedGlobalCss;

  if (page.family === "error") {
    if (inlineCss.trim()) {
      bundled += `\n\n/* Page-local styles extracted at build time. */\n${inlineCss.trim()}\n`;
    }
    return minifyCss(rewriteCssAssetUrls(bundled));
  }

  const enabled = new Set(page.features.css);
  const sharedMoneyCalculator =
    enabled.has("shared-money-calculator") && !enabled.has("impact-money-making")
      ? extractSharedMoneyCalculatorCss(normalizedGlobalCss)
      : "";

  for (const block of CSS_BLOCKS) {
    if (!enabled.has(block.key)) {
      bundled = removeDelimitedBlock(bundled, block.start, block.end);
    }
  }

  if (!isCommercialFamily(page.family)) {
    bundled = removeDelimitedBlock(
      bundled,
      COMMERCIAL_CSS_RANGE.start,
      COMMERCIAL_CSS_RANGE.end,
    );
  }

  if (inlineCss.trim()) {
    bundled += `\n\n/* Page-local styles extracted at build time. */\n${inlineCss.trim()}\n`;
  }
  if (sharedMoneyCalculator) {
    bundled += `\n\n/* Shared calculator styles selected from the authoring stylesheet. */\n${sharedMoneyCalculator}\n`;
  }
  return minifyCss(rewriteCssAssetUrls(bundled));
}

function removeFunction(source, name) {
  const marker = `  function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing JavaScript function: ${name}`);
  const next = source.indexOf("\n  function ", start + marker.length);
  if (next < 0) throw new Error(`Could not find the boundary after JavaScript function ${name}`);
  return source.slice(0, start) + source.slice(next + 1);
}

function removeInitializerCall(source, name) {
  return source.replace(new RegExp(`^\\s*${name}\\(\\);\\r?\\n`, "m"), "");
}

function removeDataRange(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Missing JavaScript data markers: ${startMarker} -> ${endMarker}`);
  }
  return source.slice(0, start) + source.slice(end);
}

function selectedFunctionNames(page) {
  const selected = new Set();
  for (const feature of page.features.js) {
    for (const name of JS_FEATURES[feature] || []) selected.add(name);
  }
  return selected;
}

export function createPageJs(globalJs, page, discord, inlineJs = "") {
  let bundled = String(globalJs).replace(/\r\n?/g, "\n");
  const selected = selectedFunctionNames(page);
  const includesLanguage = page.features.js.includes("language-switcher");

  bundled = bundled.replace(
    /var discordUsername = ["'][^"']+["'];/,
    `var discordUsername = ${JSON.stringify(discord.username)};`,
  );

  if (!includesLanguage) {
    bundled = removeDataRange(
      bundled,
      "  function getBrowserStorage(name) {",
      "  var impactSlayerTaskTiers = [",
    );
    bundled = bundled.replace(/^\s*var languageMenuCloseTimer;\r?\n/m, "");
    bundled = removeInitializerCall(bundled, "initLanguageSwitcher");
  }

  if (!selected.has("initImpactSlayerTierHelper") && !selected.has("initImpactSlayerDirectory")) {
    bundled = removeDataRange(
      bundled,
      "  var impactSlayerTaskTiers = [",
      "  var impactHunterData = {",
    );
  }
  if (!selected.has("initImpactHunterPlanner")) {
    bundled = removeDataRange(
      bundled,
      "  var impactHunterData = {",
      "  var impactThievingData = {",
    );
  }
  if (!selected.has("initImpactThievingPlanner")) {
    bundled = removeDataRange(
      bundled,
      "  var impactThievingData = {",
      "  function reportInteraction(action, element) {",
    );
  }

  for (const name of FEATURE_FUNCTIONS) {
    if (!selected.has(name)) {
      bundled = removeFunction(bundled, name);
      bundled = removeInitializerCall(bundled, name);
    }
  }

  bundled = bundled.replace(/(["'])assets\//g, "$1/assets/");
  if (inlineJs.trim()) {
    bundled += `\n\n/* Page-local runtime extracted at build time. */\n${inlineJs.trim()}\n`;
  }
  return minifyJavaScript(bundled);
}
