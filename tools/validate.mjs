import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script as VmScript } from "node:vm";

import {
  assertAuthoredJavaScriptIsEnabled,
  buildSite,
  renderCompatibilityScript,
} from "./build.mjs";
import {
  PAGE_FAMILIES,
  pageByOutput,
  pages,
  translationClusters,
} from "../src/data/pages.mjs";
import {
  ANALYTICS,
  DISCORD,
  PAYMENT_POLICY,
  REPUTATION,
  SERVER_ORDER,
  SERVERS,
  UI_COPY,
  formatCommercialPaymentFaqAnswer,
  formatCommercialPaymentFaqQuestion,
  formatPaymentProcessorQuestion,
  formatReputationText,
  formatSupportedServersFaqAnswer,
  formatUsdAmount,
  site,
} from "../src/data/site.mjs";
import {
  CSS_BLOCKS,
  COMMERCIAL_CSS_RANGE,
  createPageCss,
  minifyCss,
  minifyJavaScript,
} from "./lib/bundles.mjs";
import {
  comparePaths,
  contentHash,
  createFileHashMap,
  discoverFiles,
  sha256,
  toPosixPath,
} from "./lib/files.mjs";
import {
  extractInlineHeadStyles,
  extractInlineRuntimeScripts,
  renderAnalytics,
  renderCanonicalAndLanguages,
  renderCanonicalHomeLinks,
  renderDiscordIdentity,
  renderPaymentPolicy,
  renderPublishedRates,
  renderReputation,
  renderSkipLink,
  renderSupportedServersFaq,
} from "./lib/html-render.mjs";
import {
  decodeHtmlEntities,
  discoverHtmlFiles,
  extractHeadings,
  extractIds,
  extractVisibleFaqs,
  parseAttributes,
  parseJsonLdScripts,
  resolveLocalUrl,
  scanHtmlTags,
  toPlainText,
} from "../scripts/lib/html.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GROUPS = Object.freeze([
  ["inventory", "Source inventory"],
  ["build", "Deterministic build"],
  ["html", "HTML, links and accessibility"],
  ["routes", "Canonical URLs and languages"],
  ["faq", "FAQ and structured-data parity"],
  ["content", "Shared business data"],
  ["guides", "Guide relationships"],
  ["features", "Interactive feature safeguards"],
  ["assets", "Bundles and optimized assets"],
]);

const SOURCE_EXCLUDED_PREFIXES = [".git/", "dist/", "node_modules/"];
const SOURCE_CSS_UPPER_BOUND = 300_000;
const SOURCE_JS_UPPER_BOUND = 100_000;
const HOME_CSS_BUDGET = 200_000;
const OTHER_CSS_BUDGET = 150_000;
const HOME_JS_BUDGET = 30_000;
const OTHER_JS_BUDGET = 25_000;

const SPAWNPK_RANKS = Object.freeze([
  "normal",
  "super",
  "elite",
  "vip",
  "legendary",
  "sponsor",
  "mythic",
  "cosmic",
]);

const SPAWNPK_FEATURES = Object.freeze({
  "es/spawnpk-gold.html": {
    script: "spawnpk-gold.js",
    hooks: ["data-spawnpk-request-controls", "data-spawnpk-example"],
  },
  "spawnpk-gold.html": {
    script: "spawnpk-gold.js",
    hooks: ["data-spawnpk-request-controls", "data-spawnpk-example"],
  },
  "spawnpk-donator-ranks-guide.html": {
    script: "spawnpk-donator-ranks.js",
    hooks: [
      "data-spawnpk-rank-calculator",
      "data-rank-form",
      "data-rank-target",
      "data-rank-result",
      "data-rank-progress",
    ],
  },
  "spawnpk-money-making-guide.html": {
    script: "spawnpk-money-making-guide.js",
    hooks: [
      "data-finder-field",
      "data-finder-results",
      "data-calc",
      "data-calc-result",
      "data-calc-output",
    ],
  },
  "spawnpk-starter-guide.html": {
    script: "spawnpk-starter-guide.js",
    hooks: [
      "data-checklist-item",
      "data-checklist-count",
      "data-checklist-bar",
      "data-checklist-reset",
      "data-checklist-status",
    ],
  },
});

function newReport(rootDir) {
  return {
    ok: false,
    rootDir,
    groups: Object.fromEntries(
      GROUPS.map(([key, label]) => [key, { label, checks: 0, issues: 0 }]),
    ),
    issues: [],
    warnings: [],
    summary: {
      sourcePages: 0,
      generatedPages: 0,
      outputFiles: 0,
      faqPages: 0,
      visibleFaqs: 0,
      schemaFaqs: 0,
      cssBytes: 0,
      jsBytes: 0,
      optimizedBytesSaved: 0,
    },
  };
}

function addIssue(report, group, code, file, message) {
  report.groups[group].issues += 1;
  report.issues.push({ group, code, file: file || null, message });
}

function check(report, group, condition, code, file, message) {
  report.groups[group].checks += 1;
  if (!condition) addIssue(report, group, code, file, message);
  return Boolean(condition);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function typeIncludes(node, expected) {
  return (
    node?.["@type"] === expected ||
    (Array.isArray(node?.["@type"]) && node["@type"].includes(expected))
  );
}

function canonicalFor(page) {
  return `${site.origin}${page.pathname}`;
}

function commercialPagesForServer(serverId, language = "en") {
  return pages.filter(
    (page) =>
      page.server === serverId &&
      page.language === language &&
      page.family.startsWith("commercial-"),
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getTagEntries(html, tagName) {
  const entries = [];
  const expression = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  for (const match of html.matchAll(expression)) {
    entries.push({
      raw: match[0],
      index: match.index,
      attributes: parseAttributes(match[0]),
    });
  }
  return entries;
}

function getElementEntries(html, tagName) {
  const entries = [];
  const expression = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)</${tagName}\\s*>`, "gi");
  for (const match of html.matchAll(expression)) {
    entries.push({
      raw: match[0],
      content: match[2],
      index: match.index,
      attributes: parseAttributes(`<${tagName}${match[1]}>`),
    });
  }
  return entries;
}

function hasClass(attributes, className) {
  return String(attributes.class || "").split(/\s+/).includes(className);
}

function classElements(html, tagName, className) {
  return getElementEntries(html, tagName).filter(({ attributes }) =>
    hasClass(attributes, className),
  );
}

function classTags(html, tagName, className) {
  return getTagEntries(html, tagName).filter(({ attributes }) =>
    hasClass(attributes, className),
  );
}

function getMetaValues(html, key) {
  const expected = key.toLowerCase();
  return getTagEntries(html, "meta")
    .filter(({ attributes }) =>
      String(attributes.property || attributes.name || "").toLowerCase() === expected,
    )
    .map(({ attributes }) => attributes.content || "");
}

function getCanonicalValues(html) {
  return getTagEntries(html, "link")
    .filter(({ attributes }) =>
      String(attributes.rel || "").toLowerCase().split(/\s+/).includes("canonical"),
    )
    .map(({ attributes }) => attributes.href || "");
}

function getAlternateLinks(html) {
  return getTagEntries(html, "link")
    .filter(({ attributes }) =>
      String(attributes.rel || "").toLowerCase().split(/\s+/).includes("alternate") &&
      Object.hasOwn(attributes, "hreflang"),
    )
    .map(({ attributes }) => ({
      language: attributes.hreflang,
      href: attributes.href || "",
    }));
}

function publicIdEntries(html, file = "") {
  return extractIds(html, file).filter((entry) => {
    if (entry.tagName === "style") return false;
    if (entry.tagName !== "script") return true;
    const tag = html.slice(entry.location.start.offset, entry.location.end.offset);
    const type = String(parseAttributes(tag).type || "").toLowerCase();
    return type === "application/json" || type === "application/ld+json";
  });
}

function dataHookSignatures(html) {
  const signatures = [];
  for (const match of html.matchAll(/<([A-Za-z][\w:-]*)\b[^>]*>/g)) {
    const attributes = parseAttributes(match[0]);
    const hooks = Object.keys(attributes).filter((name) => name.startsWith("data-")).sort();
    for (const hook of hooks) {
      signatures.push(`${match[1].toLowerCase()}:${hook}=${attributes[hook]}`);
    }
  }
  return signatures;
}

function sourceHtmlInventory(rootDir) {
  return discoverHtmlFiles(rootDir).filter(
    (file) => !SOURCE_EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
}

function resolveSiteUrl(value, fromFile, rootDir) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const absolute = new URL(raw);
    if (absolute.origin !== site.origin) return null;
    return resolveLocalUrl(
      `${absolute.pathname}${absolute.search}${absolute.hash}`,
      fromFile,
      rootDir,
    );
  } catch {
    return resolveLocalUrl(raw, fromFile, rootDir);
  }
}

function srcsetUrls(value) {
  return String(value || "")
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function htmlReferences(html) {
  const references = [];
  const definitions = [
    ["a", "href"],
    ["area", "href"],
    ["form", "action"],
    ["iframe", "src"],
    ["img", "src"],
    ["link", "href"],
    ["object", "data"],
    ["script", "src"],
    ["source", "src"],
    ["track", "src"],
    ["video", "poster"],
    ["video", "src"],
    ["audio", "src"],
    ["use", "href"],
  ];
  for (const [tagName, attribute] of definitions) {
    for (const entry of getTagEntries(html, tagName)) {
      if (Object.hasOwn(entry.attributes, attribute)) {
        references.push({ tagName, attribute, value: entry.attributes[attribute] });
      }
    }
  }
  for (const tagName of ["img", "source"]) {
    for (const entry of getTagEntries(html, tagName)) {
      for (const attribute of ["srcset"]) {
        if (!entry.attributes[attribute]) continue;
        for (const value of srcsetUrls(entry.attributes[attribute])) {
          references.push({ tagName, attribute, value });
        }
      }
    }
  }
  for (const key of ["og:image", "twitter:image"]) {
    for (const value of getMetaValues(html, key)) {
      references.push({ tagName: "meta", attribute: "content", value });
    }
  }
  return references;
}

function uniqueInOrder(values) {
  return [...new Set(values)];
}

function sourceBundleReferences(html, page, rootDir) {
  const css = getTagEntries(html, "link")
    .filter(({ attributes }) =>
      String(attributes.rel || "").toLowerCase().split(/\s+/).includes("stylesheet"),
    )
    .map(({ attributes }) => resolveSiteUrl(attributes.href, page.source, rootDir)?.file)
    .filter((file) => file?.endsWith(".css") && file !== "styles.css");
  const js = getTagEntries(html, "script")
    .map(({ attributes }) => resolveSiteUrl(attributes.src, page.source, rootDir)?.file)
    .filter((file) => file?.endsWith(".js") && file !== "script.js");
  return { css: uniqueInOrder(css), js: uniqueInOrder(js) };
}

function bundleSourceMarkers(source, type) {
  const label = type === "css" ? "Page stylesheet" : "Page runtime";
  const expression = new RegExp(
    `^/\\* ${label}: ([^*\\r\\n]+?) \\*/\\s*$`,
    "gm",
  );
  return [...String(source).matchAll(expression)].map((match) => match[1].trim());
}

function expectedBundledCssSource(source) {
  return minifyCss(String(source)
    .replace(/\r\n?/g, "\n")
    .trim()
    .replace(/url\((['"]?)assets\//g, "url($1/assets/")
    .replace(
      /assets\/rsps-adventure-background\.png/g,
      "assets/rsps-adventure-background.webp",
    )
    .replace(
      /assets\/images\/wide_bright_medieval_fantasy_runescape_style_vill\.png/g,
      "assets/images/wide_bright_medieval_fantasy_runescape_style_vill.webp",
    ));
}

function normalizedHeadingSequence(html, file) {
  return extractHeadings(html, file).map(({ level, text }) => `${level}:${text}`);
}

function collectStrings(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(collectStrings);
}

function visibleBodyText(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  return toPlainText(body);
}

function serverNameMatches(text, server) {
  const normalized = String(text).toLowerCase();
  return [server.canonicalName, ...server.aliases].some((name) =>
    normalized.includes(name.toLowerCase()),
  );
}

function rateMatches(text, server, language = "en") {
  if (!server.publishedRate || !server.currency.units) return [];
  const units = Object.values(server.currency.units).filter(Boolean).map(escapeRegExp).join("|");
  const unitSeparator = language === "es" ? "por" : "per";
  const expression = new RegExp(
    `\\$(\\d+(?:\\.\\d+)?)\\s+${unitSeparator}\\s+(${units})(?:\\s+PKP)?`,
    "gi",
  );
  return [...String(text).matchAll(expression)];
}

function faqSchemaRecord(nodes) {
  return nodes.filter((node) => typeIncludes(node, "FAQPage"));
}

function schemaFaqItems(node) {
  return (node?.mainEntity || []).map((entry) => ({
    question: toPlainText(entry?.name || ""),
    answer: toPlainText(entry?.acceptedAnswer?.text || ""),
  }));
}

async function validateInventory(report, rootDir) {
  const actual = sourceHtmlInventory(rootDir).sort(comparePaths);
  const expected = pages.map(({ source }) => source).sort(comparePaths);
  report.summary.sourcePages = actual.length;
  check(
    report,
    "inventory",
    arraysEqual(actual, expected),
    "SOURCE_PAGE_MANIFEST_MISMATCH",
    null,
    `Source HTML inventory must exactly match the ${expected.length}-page manifest (found ${actual.length}).`,
  );
  check(
    report,
    "inventory",
    pages.length === 34,
    "PAGE_COUNT_CHANGED",
    "src/data/pages.mjs",
    `Page manifest must preserve 34 public HTML outputs, found ${pages.length}.`,
  );
  check(
    report,
    "inventory",
    pages.filter(({ faqPage }) => faqPage).length === 19,
    "FAQ_SCOPE_CHANGED",
    "src/data/pages.mjs",
    "The preserved FAQPage scope must contain exactly 19 pages.",
  );
  check(
    report,
    "inventory",
    pages.filter(({ sitemap }) => sitemap).length === 33,
    "SITEMAP_SCOPE_CHANGED",
    "src/data/pages.mjs",
    "The sitemap manifest scope must contain exactly 33 pages.",
  );
  return actual;
}

async function validatePackageMetadata(report, rootDir) {
  let packageJson;
  let lockfile;
  let nodeVersion = "";
  try {
    [packageJson, lockfile, nodeVersion] = await Promise.all([
      fs.readFile(path.join(rootDir, "package.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(rootDir, "package-lock.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(rootDir, ".nvmrc"), "utf8").then((value) => value.trim()),
    ]);
  } catch (error) {
    addIssue(report, "build", "PACKAGE_METADATA_INVALID", "package.json", error.message);
    return;
  }
  check(
    report,
    "build",
    packageJson.private === true && packageJson.type === "module" &&
      packageJson.scripts?.validate === "node tools/validate.mjs" &&
      packageJson.scripts?.build === "node tools/build.mjs",
    "PACKAGE_SCRIPT_DRIFT",
    "package.json",
    "package.json must expose the consolidated validator and deterministic builder as the exact npm scripts.",
  );
  const rootPackage = lockfile.packages?.[""];
  check(
    report,
    "build",
    lockfile.lockfileVersion === 3 && lockfile.name === packageJson.name &&
      lockfile.version === packageJson.version && rootPackage?.name === packageJson.name &&
      rootPackage?.version === packageJson.version &&
      rootPackage?.engines?.node === packageJson.engines?.node,
    "PACKAGE_LOCK_DRIFT",
    "package-lock.json",
    "The npm lockfile root package and Node engine must match package.json.",
  );
  check(
    report,
    "build",
    nodeVersion === "24" && /^>=24(?:\.0\.0)?$/.test(packageJson.engines?.node || ""),
    "NODE_VERSION_DRIFT",
    ".nvmrc",
    "The local and package Node declarations must both target Node.js 24.",
  );
}

function workflowJobBlock(workflow, jobName) {
  const lines = String(workflow).replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function actionMajors(workflow, action) {
  const expression = new RegExp(
    `\\buses:\\s*${escapeRegExp(action)}@v(\\d+)(?:\\.[0-9.]+)?\\b`,
    "gi",
  );
  return [...String(workflow).matchAll(expression)].map((match) => Number(match[1]));
}

async function validateWorkflow(report, rootDir) {
  const workflowFile = ".github/workflows/pages.yml";
  let workflow;
  try {
    workflow = await fs.readFile(path.join(rootDir, workflowFile), "utf8");
  } catch (error) {
    addIssue(report, "build", "PAGES_WORKFLOW_MISSING", workflowFile, error.message);
    return;
  }

  const requiredActions = [
    ["actions/checkout", 6],
    ["actions/setup-node", 6],
    ["actions/configure-pages", 6],
    ["actions/upload-pages-artifact", 5],
    ["actions/deploy-pages", 5],
  ];
  for (const [action, minimumMajor] of requiredActions) {
    const majors = actionMajors(workflow, action);
    check(
      report,
      "build",
      majors.length === 1 && majors[0] >= minimumMajor,
      "WORKFLOW_ACTION_VERSION",
      workflowFile,
      `${action} must appear exactly once at v${minimumMajor} or newer (found ${majors.length ? majors.map((major) => `v${major}`).join(", ") : "none"}).`,
    );
  }

  const quality = workflowJobBlock(workflow, "quality");
  const deploy = workflowJobBlock(workflow, "deploy");
  const qualityOrder = [
    quality.search(/uses:\s*actions\/checkout@/i),
    quality.search(/uses:\s*actions\/setup-node@/i),
    quality.indexOf("npm run validate"),
    quality.indexOf("npm run build"),
    quality.search(/uses:\s*actions\/upload-pages-artifact@/i),
  ];
  check(
    report,
    "build",
    qualityOrder.every((index) => index >= 0) &&
      qualityOrder.every((index, position) => position === 0 || index > qualityOrder[position - 1]),
    "WORKFLOW_QUALITY_ORDER",
    workflowFile,
    "The quality job must check out, set up Node, validate, build and upload in that order.",
  );
  check(
    report,
    "build",
    /node-version:\s*["']?24(?:\.x)?["']?\s*(?:#.*)?$/mi.test(quality),
    "WORKFLOW_NODE_VERSION",
    workflowFile,
    "The quality job must explicitly run Node.js 24.",
  );
  const configureIndex = deploy.search(/uses:\s*actions\/configure-pages@/i);
  const deployIndex = deploy.search(/uses:\s*actions\/deploy-pages@/i);
  check(
    report,
    "build",
    Boolean(quality) &&
      Boolean(deploy) &&
      /^\s{4}needs:\s*quality\s*(?:#.*)?$/mi.test(deploy) &&
      configureIndex >= 0 &&
      deployIndex > configureIndex,
    "WORKFLOW_DEPLOY_DEPENDENCY",
    workflowFile,
    "The configure/deploy job must depend on the complete quality job and configure Pages before deployment.",
  );
}

async function validateSafeOutputGuard(report, rootDir, temporaryDirectories) {
  let directory;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "rsps-gold-safe-output-"));
    temporaryDirectories.push(directory);
    const sentinelPath = path.join(directory, "sentinel.txt");
    const sentinel = "RSPS validator preservation sentinel\n";
    await fs.writeFile(sentinelPath, sentinel, "utf8");

    let safelyRefused = false;
    try {
      await buildSite({ rootDir, outputDir: directory, quiet: true });
    } catch (error) {
      safelyRefused = /Refusing to clear a non-empty directory/i.test(error.message);
    }
    check(
      report,
      "build",
      safelyRefused,
      "UNSAFE_OUTPUT_NOT_REFUSED",
      toPosixPath(directory),
      "A non-empty arbitrary output directory must be rejected before the build writes anything.",
    );

    let preserved = false;
    try {
      const [contents, entries] = await Promise.all([
        fs.readFile(sentinelPath, "utf8"),
        fs.readdir(directory),
      ]);
      preserved = contents === sentinel && arraysEqual(entries.sort(comparePaths), ["sentinel.txt"]);
    } catch {
      preserved = false;
    }
    check(
      report,
      "build",
      preserved,
      "UNSAFE_OUTPUT_MUTATED",
      toPosixPath(directory),
      "A refused output directory and its sentinel must remain byte-for-byte unchanged.",
    );
  } catch (error) {
    addIssue(report, "build", "SAFE_OUTPUT_TEST_FAILED", directory || null, error.message);
  }
}

function mutationCheck(report, group, code, file, message, probe) {
  let passed = false;
  let diagnostic = message;
  try {
    passed = Boolean(probe());
  } catch (error) {
    diagnostic = `${message} Probe error: ${error.message}`;
  }
  check(report, group, passed, code, file, diagnostic);
}

function cssRangeStatus(source, range) {
  const css = String(source).replace(/\r\n?/g, "\n");
  const occurrences = (marker) => css.split(marker).length - 1;
  const startCount = occurrences(range.start);
  const endCount = range.end === null ? 1 : occurrences(range.end);
  return {
    startCount,
    endCount,
    ordered:
      startCount === 1 &&
      endCount === 1 &&
      (range.end === null || css.indexOf(range.end) > css.indexOf(range.start)),
  };
}

function validateFocusedMutations(report) {
  mutationCheck(report, "routes", "HOME_ALIAS_LINK_REWRITE_UNSAFE",
    "tools/lib/html-render.mjs", "Normalize only home navigation aliases and preserve language, fragments, queries and raw text.", () => {
      const fixture = `<a href="index.html#buy-gold">Local</a><a href='../index.html?q=a&amp;b=2#servers'>English</a>` +
        `<a title="a > b" href=/es/index.html>Spanish</a><a href="${site.origin}/index.html">Absolute</a>` +
        `<a href="https://other.invalid/index.html">External</a><a href="#faq">Fragment</a>` +
        `<a href="/guides/index.html">Other directory</a><a download href="/index.html">Download</a>` +
        `<!-- <a href="/index.html">Comment</a> --><script>var example = '<a href="/index.html">';</script>`;
      const result = renderCanonicalHomeLinks(fixture, `${site.origin}/es/spawnpk-gold.html`);
      const links = scanHtmlTags(result).filter(t => t.name === "a" && !t.closing).map(t => t.attributes.href);
      return JSON.stringify(links) === JSON.stringify([
        "/es/#buy-gold", "/?q=a&b=2#servers", "/es/", "/",
        "https://other.invalid/index.html", "#faq", "/guides/index.html", "/index.html",
      ]) && result.includes(`<!-- <a href="/index.html">Comment</a> -->`) &&
        result.includes(`<script>var example = '<a href="/index.html">';</script>`) &&
        result === renderCanonicalHomeLinks(result, `${site.origin}/es/spawnpk-gold.html`);
    });
  mutationCheck(
    report,
    "content",
    "DISCORD_MUTATION_UNSAFE",
    "tools/lib/html-render.mjs",
    "Changing Discord identity must update identity-owned values while preserving immutable third-party reputation URLs.",
    () => {
      const templateUsername = DISCORD.templateUsernames?.[0];
      const templateUserId = DISCORD.templateUserIds?.[0];
      if (!templateUsername || !templateUserId) return false;
      const changed = {
        ...DISCORD,
        username: "validatorprobe",
        displayName: "VALIDATORPROBE",
        userId: "123456789012345678",
        profileUrl: "https://discord.com/users/123456789012345678",
      };
      const fixture =
        `<p>${templateUsername} ${templateUsername.toUpperCase()} ${templateUserId}</p>` +
        `<a href="https://discord.com/users/${templateUserId}">Discord ${templateUserId}</a>` +
        `<a data-reputation-profile-url="https://www.sythe.org/threads/${templateUsername}-vouches/">Vouches</a>`;
      const rendered = renderDiscordIdentity(fixture, changed);
      const preservedVouchUrl = `https://www.sythe.org/threads/${templateUsername}-vouches/`;
      const identityOwned = rendered.replace(preservedVouchUrl, "");
      return (
        rendered.includes(changed.username) &&
        rendered.includes(changed.displayName) &&
        rendered.includes(changed.profileUrl) &&
        !new RegExp(`\\b${escapeRegExp(templateUsername)}\\b`, "i").test(identityOwned) &&
        !rendered.includes(templateUserId) &&
        rendered.includes(preservedVouchUrl)
      );
    },
  );

  mutationCheck(
    report,
    "content",
    "DISCORD_COMPATIBILITY_MUTATION_UNSAFE",
    "tools/build.mjs",
    "Changing the configured Discord username must also update the compatibility script.",
    () => {
      const templateUsername = DISCORD.templateUsernames?.[0];
      if (!templateUsername) return false;
      const changed = { ...DISCORD, username: "validatorprobe" };
      const rendered = renderCompatibilityScript(
        `var discordUsername = ${JSON.stringify(templateUsername)};`,
        changed,
      );
      return rendered.includes(JSON.stringify(changed.username)) &&
        !rendered.includes(JSON.stringify(templateUsername));
    },
  );

  mutationCheck(
    report,
    "content",
    "PAYMENT_HOSTNAME_MUTATION_UNSAFE",
    "src/data/site.mjs",
    "Changing the configured origin must also update the payment-processor hostname wording.",
    () => {
      const changedOrigin = "https://validator-payment.invalid";
      const rendered = formatPaymentProcessorQuestion(changedOrigin);
      return rendered === "Does validator-payment.invalid process payments?" &&
        !rendered.includes(new URL(site.origin).hostname);
    },
  );

  mutationCheck(
    report,
    "content",
    "ANALYTICS_INJECTION_UNSAFE",
    "tools/lib/html-render.mjs",
    "A configured analytics script must be injected once with defer and its configured domain.",
    () => {
      const configured = {
        domain: "validator.example",
        scriptUrl: "https://analytics.example/tracker.js",
      };
      const rendered = renderAnalytics("<html><head></head><body></body></html>", configured);
      const scripts = getTagEntries(rendered, "script").filter(
        ({ attributes }) => Object.hasOwn(attributes, "data-rsps-analytics"),
      );
      return scripts.length === 1 && scripts[0].attributes.src === configured.scriptUrl &&
        scripts[0].attributes["data-domain"] === configured.domain &&
        Object.hasOwn(scripts[0].attributes, "defer");
    },
  );

  mutationCheck(
    report,
    "content",
    "SUPPORTED_SERVERS_MUTATION_UNSAFE",
    "src/data/site.mjs",
    "Changing the configured server order or names must update the localized supported-server FAQ answer.",
    () => {
      const changedServers = {
        beta: { canonicalName: "Validator Beta" },
        alpha: { canonicalName: "Validator Alpha" },
        other: { canonicalName: "Other" },
      };
      const answer = formatSupportedServersFaqAnswer("es", {
        serverOrder: ["beta", "alpha", "other"],
        servers: changedServers,
        acceptsOtherServers: false,
      });
      const rendered = renderSupportedServersFaq(
        '<details><summary>¿Qué servidores RSPS son compatibles?</summary><p>Texto anterior.</p></details>',
        { family: PAGE_FAMILIES.home, language: "es" },
        answer,
      );
      return rendered.includes(answer) &&
        rendered.includes("Validator Beta y Validator Alpha") &&
        answer.indexOf("Validator Beta") < answer.indexOf("Validator Alpha") &&
        !answer.includes("caso por caso") &&
        !rendered.includes("Texto anterior.") &&
        !Object.values(SERVERS).some(({ canonicalName }) => answer.includes(canonicalName));
    },
  );

  mutationCheck(
    report,
    "content",
    "SPANISH_PAYMENT_MUTATION_UNSAFE",
    "tools/lib/html-render.mjs",
    "Changing localized Spanish payment-policy FAQ wording must replace the visible FAQ answer.",
    () => {
      const changedAnswer = "Texto de política cambiado por la validación.";
      const changedPolicy = {
        fragments: {
          es: {
            ...PAYMENT_POLICY.fragments.es,
            faq: {
              ...PAYMENT_POLICY.fragments.es.faq,
              deliveryAnswer: changedAnswer,
            },
          },
        },
      };
      const fixture =
        '<details><summary>¿Cómo se entrega el oro?</summary><p>Texto anterior.</p></details>';
      const rendered = renderPaymentPolicy(
        fixture,
        { family: PAGE_FAMILIES.home, language: "es" },
        changedPolicy,
      );
      return rendered.includes(changedAnswer) && !rendered.includes("Texto anterior.");
    },
  );

  mutationCheck(
    report,
    "content",
    "SPANISH_RATE_MUTATION_UNSAFE",
    "tools/lib/html-render.mjs",
    "A changed published rate must replace a Spanish template rate that uses the localized “por” connector.",
    () => {
      const original = SERVERS.impact;
      const templateUnit = original.currency.templateUnits?.short || original.currency.units.short;
      const originalAmount = formatUsdAmount(original.publishedRate.usd, {
        fractionDigits: original.publishedRate.fractionDigits,
      });
      const changedRate = {
        ...original.publishedRate,
        usd: original.publishedRate.usd + 137,
      };
      const changed = { ...original, publishedRate: changedRate };
      const rendered = renderPublishedRates(
        `<p>Desde <strong>$${originalAmount}</strong> por ${templateUnit}</p>`,
        { family: PAGE_FAMILIES.commercialFeatured, server: "impact", language: "es" },
        { impact: changed },
        formatUsdAmount,
      );
      const expectedAmount = formatUsdAmount(changedRate.usd, {
        fractionDigits: changedRate.fractionDigits,
      });
      return (
        rendered.includes(`<strong>$${expectedAmount}</strong> por ${changed.currency.units.short}`) &&
        !rendered.includes(`<strong>$${originalAmount}</strong>`)
      );
    },
  );

  mutationCheck(
    report,
    "content",
    "RATE_UNIT_MUTATION_UNSAFE",
    "tools/lib/html-render.mjs",
    "Changed rate units must replace both short and long units retained by source templates.",
    () => {
      const original = SERVERS.impact;
      const templateUnits = original.currency.templateUnits || original.currency.units;
      const changed = {
        ...original,
        currency: {
          ...original.currency,
          units: { short: "9Q", long: "Quads" },
          templateUnits,
        },
      };
      const amount = formatUsdAmount(original.publishedRate.usd, {
        fractionDigits: original.publishedRate.fractionDigits,
      });
      const fixture =
        `<p>$${amount} per ${templateUnits.short}</p>` +
        `<p>$${amount} per ${templateUnits.long}</p>`;
      const rendered = renderPublishedRates(
        fixture,
        { family: PAGE_FAMILIES.commercialFeatured, server: "impact", language: "en" },
        { impact: changed },
        formatUsdAmount,
      );
      return (
        rendered.includes(`per ${changed.currency.units.short}`) &&
        rendered.includes(`per ${changed.currency.units.long}`) &&
        !rendered.includes(`per ${templateUnits.short}`) &&
        !rendered.includes(`per ${templateUnits.long}`)
      );
    },
  );

  mutationCheck(
    report,
    "routes",
    "ORIGIN_MUTATION_UNSAFE",
    "tools/lib/html-render.mjs",
    "Changing the configured site origin must remove the complete template origin from rendered HTML.",
    () => {
      const changedOrigin = "https://validator-origin.invalid";
      const mutationPage = {
        source: "origin-mutation.html",
        output: "origin-mutation.html",
        pathname: "/origin-mutation.html",
        language: "en",
        indexable: true,
      };
      const fixture =
        `<html><head><link rel="canonical" href="${site.origin}/old.html" />` +
        `<meta property="og:url" content="${site.origin}/old.html" /></head>` +
        `<body><a href="${site.origin}/guide.html">Guide</a>` +
        `<script type="application/ld+json">{"url":"${site.origin}/schema"}</script></body></html>`;
      const rendered = renderCanonicalAndLanguages(fixture, mutationPage, {
        canonicalUrl: (page) => `${changedOrigin}${page.pathname}`,
        translationsFor: () => [mutationPage],
        defaultTranslationFor: () => mutationPage,
        publicPath: (page) => page.pathname,
      });
      return (
        rendered.canonical === `${changedOrigin}${mutationPage.pathname}` &&
        !rendered.html.includes(site.origin) &&
        rendered.html.split(changedOrigin).length - 1 >= 4
      );
    },
  );

  mutationCheck(
    report,
    "build",
    "NOSCRIPT_CSS_BECOMES_UNCONDITIONAL",
    "tools/lib/html-render.mjs",
    "No-JavaScript fallback CSS must remain conditional while ordinary and media styles are bundled.",
    () => {
      const fallback = '<noscript><style>.copy-btn{display:none}</style></noscript>';
      const fixture = '<head><style>.page{color:white}</style>' + fallback +
        '<style media="print">.page{color:black}</style></head><body></body>';
      const result = extractInlineHeadStyles(fixture);
      return result.html.includes(fallback) && !result.css.includes('.copy-btn') &&
        result.css.includes('.page{color:white}') && result.css.includes('@media print') &&
        !result.html.includes('media="print"');
    },
  );

  mutationCheck(
    report,
    "build",
    "DISABLED_JS_LOSS_UNGUARDED",
    "tools/build.mjs",
    "A page manifest that disables JavaScript must reject extracted executable page JavaScript instead of silently dropping it.",
    () => {
      const disabledPage = { source: "probe.html", features: { js: [] } };
      const jsonLd = extractInlineRuntimeScripts(
        '<script type="application/ld+json">{"@type":"WebPage"}</script>',
      );
      if (jsonLd.js || !jsonLd.html.includes("application/ld+json")) return false;
      assertAuthoredJavaScriptIsEnabled(disabledPage, { js: "" }, jsonLd);

      let inlineRejected = false;
      try {
        assertAuthoredJavaScriptIsEnabled(disabledPage, { js: "" }, { js: "alert('probe')" });
      } catch (error) {
        inlineRejected =
          error.message.includes("probe.html") &&
          error.message.includes("manifest disables JavaScript");
      }
      let pageLocalRejected = false;
      try {
        assertAuthoredJavaScriptIsEnabled(
          disabledPage,
          { js: "console.log('page-local')" },
          { js: "" },
        );
      } catch {
        pageLocalRejected = true;
      }
      return inlineRejected && pageLocalRejected;
    },
  );

  mutationCheck(
    report,
    "routes",
    "LANGUAGE_LINK_REWRITE_UNSAFE",
    "tools/lib/html-render.mjs",
    "Only dedicated language controls may be rewritten; an ordinary anchor with hreflang must retain its authored destination.",
    () => {
      const english = {
        source: "probe.html",
        pathname: "/probe.html",
        language: "en",
        indexable: true,
        translationKey: "probe",
      };
      const spanish = { ...english, pathname: "/es/probe.html", language: "es" };
      const fixture =
        '<link rel="canonical" href="https://old.invalid/probe.html" />' +
        '<a id="ordinary" hreflang="es" href="/independent.html">Independent</a>' +
        '<a id="control" data-language-code="es" hreflang="es" href="/old-es.html">Spanish</a>';
      const rendered = renderCanonicalAndLanguages(fixture, english, {
        canonicalUrl: (page) => `${site.origin}${page.pathname}`,
        translationsFor: () => [english, spanish],
        defaultTranslationFor: () => english,
        publicPath: (page) => page.pathname,
      }).html;
      return (
        /id="ordinary"[^>]*href="\/independent\.html"/.test(rendered) &&
        /id="control"[^>]*href="\/es\/probe\.html"/.test(rendered)
      );
    },
  );

  mutationCheck(
    report,
    "routes",
    "ERROR_PAGE_REFERENCE_CLASSIFICATION_UNSAFE",
    "tools/validate.mjs",
    "Custom error-page reference validation must allow stable absolute/root URLs and fragments while rejecting document-relative and query-only URLs.",
    () =>
      [
        "/assets/site.css",
        "//cdn.example.test/site.css",
        "https://example.test/page",
        "mailto:help@example.test",
        "tel:+4700000000",
        "#contact",
      ].every(isStableErrorPageReference) &&
      ["assets/site.css", "../index.html", "?retry=1", "index.html#servers"].every(
        (value) => !isStableErrorPageReference(value),
      ),
  );

  mutationCheck(
    report,
    "assets",
    "CSS_BLOCK_MARKER_VALIDATION_UNSAFE",
    "tools/validate.mjs",
    "CSS slicing markers must be unique and ordered so duplicate or inverted boundaries cannot redirect a build-time cut.",
    () => {
      const range = { start: "/* start */", end: "/* end */" };
      const valid = cssRangeStatus("/* start */\n.rule {}\n/* end */", range);
      const duplicate = cssRangeStatus(
        "/* start */\n.rule {}\n/* start */\n/* end */",
        range,
      );
      const inverted = cssRangeStatus("/* end */\n.rule {}\n/* start */", range);
      return valid.ordered && !duplicate.ordered && !inverted.ordered;
    },
  );
}

async function runBuilds(report, rootDir, temporaryDirectories) {
  let first = null;
  let second = null;
  let firstMap = null;
  let secondMap = null;
  const prefixes = ["rsps-gold-validate-a-", "rsps-gold-validate-b-"];
  for (const [index, prefix] of prefixes.entries()) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    temporaryDirectories.push(directory);
    try {
      const result = await buildSite({ rootDir, outputDir: directory, quiet: true });
      if (index === 0) {
        first = result;
        firstMap = await createFileHashMap(directory);
        // Retain every file hash, then release this complete build before making
        // the independent second build. This halves peak validation disk usage.
        if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
            !path.basename(directory).startsWith(prefix)) throw new Error("Unexpected validation cleanup path");
        await fs.rm(directory, { recursive: true, force: true });
      } else {
        second = result;
        secondMap = await createFileHashMap(directory);
      }
      check(report, "build", true, "BUILD_FAILED", null, "Build completed.");
    } catch (error) {
      addIssue(report, "build", "BUILD_FAILED", null, `Build ${index + 1} failed: ${error.message}`);
    }
  }

  if (!first || !second || !firstMap || !secondMap) return { first: second, second, firstMap, secondMap };
  const firstFiles = Object.keys(firstMap);
  const secondFiles = Object.keys(secondMap);
  const differing = [...new Set([...firstFiles, ...secondFiles])]
    .sort(comparePaths)
    .filter((file) => firstMap[file] !== secondMap[file]);
  report.summary.outputFiles = firstFiles.length;
  check(
    report,
    "build",
    differing.length === 0 && arraysEqual(firstFiles, secondFiles),
    "NONDETERMINISTIC_BUILD",
    null,
    differing.length
      ? `Independent builds differ for: ${differing.slice(0, 8).join(", ")}.`
      : "Independent builds produced different file inventories.",
  );
  // Downstream checks inspect the retained build; byte equality was checked above.
  return { first: second, second, firstMap, secondMap };
}

function validateHeadingAndHookPreservation(report, page, sourceHtml, generatedHtml) {
  const renderedSourceContract = renderSkipLink(
    renderReputation(
      sourceHtml,
      page,
      REPUTATION,
      { [page.language]: formatReputationText(page.language, REPUTATION) },
    ),
    page,
    UI_COPY,
  );
  const sourceHeadings = normalizedHeadingSequence(
    renderDiscordIdentity(sourceHtml, DISCORD),
    page.source,
  );
  const generatedHeadings = normalizedHeadingSequence(generatedHtml, page.output);
  check(
    report,
    "html",
    arraysEqual(sourceHeadings, generatedHeadings),
    "HEADING_SEQUENCE_CHANGED",
    page.output,
    "Generated heading levels/text must exactly preserve the source-template sequence.",
  );

  const sourceIds = publicIdEntries(renderedSourceContract, page.source).map(({ tagName, id }) => `${tagName}:${id}`);
  const generatedIds = publicIdEntries(generatedHtml, page.output).map(({ tagName, id }) => `${tagName}:${id}`);
  check(
    report,
    "features",
    arraysEqual(sourceIds, generatedIds),
    "PUBLIC_ID_CONTRACT_CHANGED",
    page.output,
    "Generated public IDs must preserve source feature and fragment hooks.",
  );

  check(
    report,
    "features",
    arraysEqual(dataHookSignatures(renderedSourceContract), dataHookSignatures(generatedHtml)),
    "DATA_HOOK_CONTRACT_CHANGED",
    page.output,
    "Generated data-* feature hooks must preserve the source-template contract.",
  );
}

function validatePageAccessibility(report, page, html, ids) {
  const headings = extractHeadings(html, page.output);
  check(
    report,
    "html",
    headings.filter(({ level }) => level === 1).length === 1,
    "H1_COUNT",
    page.output,
    "Every generated page must contain exactly one H1.",
  );

  const idEntries = extractIds(html, page.output);
  const idValues = idEntries.map(({ id }) => id);
  check(
    report,
    "html",
    idValues.length === new Set(idValues).size,
    "DUPLICATE_ID",
    page.output,
    "Generated page contains duplicate HTML IDs.",
  );

  for (const image of getTagEntries(html, "img")) {
    check(
      report,
      "html",
      Object.hasOwn(image.attributes, "alt"),
      "IMAGE_ALT_MISSING",
      page.output,
      `Image ${image.attributes.src || "(missing src)"} has no alt attribute.`,
    );
    const width = Number(image.attributes.width);
    const height = Number(image.attributes.height);
    check(
      report,
      "html",
      Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0,
      "IMAGE_DIMENSIONS_MISSING",
      page.output,
      `Image ${image.attributes.src || "(missing src)"} needs positive width and height.`,
    );
    if (/(?:alora|orion|other-rsps|roat-pkz|runex|ferox|near-reality)-logo\.webp$/i.test(
      String(image.attributes.src || ""),
    )) {
      check(
        report,
        "assets",
        Boolean(image.attributes.srcset) && Boolean(image.attributes.sizes),
        "RESPONSIVE_LOGO_MISSING",
        page.output,
        `Optimized server logo ${image.attributes.src} must provide srcset and sizes.`,
      );
    }
  }

  const labelTargets = new Set(
    getTagEntries(html, "label")
      .map(({ attributes }) => attributes.for)
      .filter(Boolean),
  );
  for (const target of labelTargets) {
    check(
      report,
      "html",
      ids.has(target),
      "LABEL_REFERENCE_MISSING",
      page.output,
      `label[for] references missing #${target}.`,
    );
  }
  for (const tagName of ["input", "select", "textarea"]) {
    for (const control of getTagEntries(html, tagName)) {
      if (tagName === "input" && String(control.attributes.type).toLowerCase() === "hidden") continue;
      const before = html.slice(0, control.index);
      const nestedLabel = before.lastIndexOf("<label") > before.lastIndexOf("</label>");
      const labelled =
        Boolean(control.attributes["aria-label"]) ||
        Boolean(control.attributes["aria-labelledby"]) ||
        Boolean(control.attributes.title) ||
        Boolean(control.attributes.alt) ||
        (control.attributes.id && labelTargets.has(control.attributes.id)) ||
        nestedLabel;
      check(
        report,
        "html",
        labelled,
        "CONTROL_LABEL_MISSING",
        page.output,
        `${tagName}${control.attributes.id ? `#${control.attributes.id}` : ""} has no accessible label.`,
      );
    }
  }
  for (const button of getElementEntries(html, "button")) {
    const labelled =
      Boolean(toPlainText(button.content)) ||
      Boolean(button.attributes["aria-label"]) ||
      Boolean(button.attributes["aria-labelledby"]) ||
      Boolean(button.attributes.title);
    check(
      report,
      "html",
      labelled,
      "BUTTON_LABEL_MISSING",
      page.output,
      "Button has no accessible label.",
    );
  }

  for (const tagName of ["a", "button", "input", "select", "textarea", "section", "nav"] ) {
    for (const entry of getTagEntries(html, tagName)) {
      for (const attribute of ["aria-labelledby", "aria-controls"]) {
        const references = String(entry.attributes[attribute] || "").trim();
        for (const id of references.split(/\s+/).filter(Boolean)) {
          check(
            report,
            "html",
            ids.has(id),
            "ARIA_REFERENCE_MISSING",
            page.output,
            `${attribute} references missing #${id}.`,
          );
        }
      }
    }
  }

  if (page.indexable) {
    const skipLinks = classElements(html, "a", "skip-link");
    const expectedText = UI_COPY[page.language]?.skipToContent;
    const href = skipLinks[0]?.attributes.href || "";
    const target = href.startsWith("#") ? decodeURIComponent(href.slice(1)) : "";
    check(
      report,
      "html",
      skipLinks.length === 1 && Boolean(target) && ids.has(target) &&
        toPlainText(skipLinks[0].content) === expectedText,
      "SKIP_LINK_INVALID",
      page.output,
      "Every indexable page must have one localized skip link targeting an existing main-content id.",
    );
  }

  for (const tagName of ["a", "form"]) {
    for (const entry of getTagEntries(html, tagName)) {
      if (String(entry.attributes.target || "").toLowerCase() !== "_blank") continue;
      const rel = new Set(String(entry.attributes.rel || "").toLowerCase().split(/\s+/));
      check(
        report,
        "html",
        rel.has("noopener"),
        "BLANK_TARGET_NO_NOOPENER",
        page.output,
        `${tagName} target=_blank must include rel=noopener.`,
      );
      if (tagName === "a") {
        check(
          report,
          "html",
          !String(entry.attributes.href || "").trim().startsWith("#"),
          "BLANK_TARGET_FRAGMENT",
          page.output,
          "Anchor target=_blank must not point at a same-document fragment; remove the target or use an external URL.",
        );
      }
    }
  }
}

function validateAnalytics(report, page, html) {
  if (!page.indexable || !ANALYTICS.scriptUrl) return;
  const scripts = getTagEntries(html, "script").filter(
    ({ attributes }) => Object.hasOwn(attributes, "data-rsps-analytics"),
  );
  check(
    report,
    "content",
    scripts.length === 1 && scripts[0].attributes.src === ANALYTICS.scriptUrl &&
      scripts[0].attributes["data-domain"] === ANALYTICS.domain &&
      Object.hasOwn(scripts[0].attributes, "defer"),
    "ANALYTICS_SCRIPT_MISSING",
    page.output,
    "Every indexable page must load the configured deferred analytics script exactly once.",
  );
}

function validateReputation(report, page, html) {
  if (page.family !== PAGE_FAMILIES.home) return;
  const expected = formatReputationText(page.language, REPUTATION);
  const entries = [
    ...getElementEntries(html, "a"),
    ...getElementEntries(html, "strong"),
    ...getElementEntries(html, "small"),
  ].filter(({ attributes }) => attributes["data-reputation-text"]);
  for (const [key, value] of Object.entries(expected)) {
    const matches = entries.filter(
      ({ attributes, content }) => attributes["data-reputation-text"] === key &&
        attributes["data-reputation-value"] === value && toPlainText(content) === value,
    );
    check(
      report,
      "content",
      matches.length > 0,
      "REPUTATION_TEXT_DRIFT",
      page.output,
      `Reputation text ${key} must be rendered from src/data/site.mjs.`,
    );
  }
  for (const [key, value] of Object.entries(REPUTATION)) {
    const links = getTagEntries(html, "a").filter(
      ({ attributes }) => attributes["data-reputation-link"] === key,
    );
    check(
      report,
      "content",
      links.length > 0 && links.every(
        ({ attributes }) => attributes["data-reputation-profile-url"] === value.profileUrl,
      ),
      "REPUTATION_LINK_DRIFT",
      page.output,
      `Reputation profile ${key} must be rendered from src/data/site.mjs.`,
    );
  }
}

function isStableErrorPageReference(value) {
  const reference = String(value || "").trim();
  if (!reference || reference.startsWith("#") || reference.startsWith("/")) return true;
  try {
    return Boolean(new URL(reference).protocol);
  } catch {
    return false;
  }
}

function validateErrorPageReferences(report, page, html) {
  if (page.family !== PAGE_FAMILIES.error) return;
  for (const reference of htmlReferences(html)) {
    check(
      report,
      "routes",
      isStableErrorPageReference(reference.value),
      "ERROR_PAGE_RELATIVE_URL",
      page.output,
      `${reference.tagName}[${reference.attribute}]="${reference.value}" must be root-relative or absolute because the custom error page can be served at a nested missing URL.`,
    );
  }
}

function validatePageRoutes(report, page, html) {
  const expectedCanonical = canonicalFor(page);
  const homeAliasLinks = scanHtmlTags(html).filter(token => {
    if (token.closing || token.name !== "a" || !token.attributes.href || "download" in token.attributes) return false;
    try {
      const target = new URL(token.attributes.href, expectedCanonical);
      return target.origin === new URL(expectedCanonical).origin &&
        ["/index.html", "/es/index.html"].includes(target.pathname);
    } catch { return false; }
  });
  check(report, "routes", homeAliasLinks.length === 0, "NONCANONICAL_HOME_LINK",
    page.output, "Home navigation must use / or /es/, retaining queries and fragments.");
  const canonicalValues = getCanonicalValues(html);
  const ogUrls = getMetaValues(html, "og:url");
  const htmlTag = getTagEntries(html, "html")[0];

  if (page.indexable) {
    check(
      report,
      "routes",
      canonicalValues.length === 1 && canonicalValues[0] === expectedCanonical,
      "CANONICAL_MISMATCH",
      page.output,
      `Canonical must be exactly ${expectedCanonical}.`,
    );
    check(
      report,
      "routes",
      ogUrls.length === 1 && ogUrls[0] === expectedCanonical,
      "OG_URL_MISMATCH",
      page.output,
      `og:url must be exactly ${expectedCanonical}.`,
    );
  } else {
    check(
      report,
      "routes",
      canonicalValues.every((value) => value === expectedCanonical) &&
        ogUrls.every((value) => value === expectedCanonical),
      "NONINDEXABLE_CANONICAL_MISMATCH",
      page.output,
      "Any canonical or og:url on a non-indexable page must match the route manifest.",
    );
  }

  check(
    report,
    "routes",
    htmlTag?.attributes.lang === page.language,
    "HTML_LANGUAGE_MISMATCH",
    page.output,
    `<html lang> must be ${page.language}.`,
  );

  const actualAlternates = getAlternateLinks(html);
  const cluster = page.translationKey ? translationClusters[page.translationKey] : null;
  const expectedAlternates = cluster
    ? [
        { language: "en", href: canonicalFor(cluster.en) },
        { language: "es", href: canonicalFor(cluster.es) },
        { language: "x-default", href: canonicalFor(cluster.en) },
      ]
    : [];
  check(
    report,
    "routes",
    JSON.stringify(actualAlternates) === JSON.stringify(expectedAlternates),
    "HREFLANG_CLUSTER_MISMATCH",
    page.output,
    cluster
      ? "English/Spanish/x-default alternates must exactly match the reciprocal manifest cluster."
      : "Pages without a translation cluster must not emit hreflang alternates.",
  );
  check(
    report,
    "routes",
    !actualAlternates.some(({ language, href }) =>
      !language || language === "undefined" || href.includes("undefined"),
    ),
    "UNRESOLVED_HREFLANG",
    page.output,
    "Generated hreflang links contain an unresolved value.",
  );

  const languageControls = getTagEntries(html, "a").filter(
    ({ attributes }) => attributes["data-language-code"],
  );
  for (const control of languageControls) {
    const language = control.attributes["data-language-code"];
    check(
      report,
      "routes",
      Boolean(cluster?.[language]) && control.attributes.href === cluster[language].pathname,
      "LANGUAGE_CONTROL_TARGET_MISMATCH",
      page.output,
      `Language control "${language}" must target its manifest translation route.`,
    );
  }
  check(
    report,
    "routes",
    Boolean(cluster) || languageControls.length === 0,
    "LANGUAGE_CONTROL_WITHOUT_CLUSTER",
    page.output,
    "Pages outside a translation cluster must not declare manifest-managed language controls.",
  );
}

function validateJsonLdAndFaq(report, page, html) {
  const scripts = parseJsonLdScripts(html, page.output);
  for (const script of scripts) {
    check(
      report,
      "html",
      !script.error,
      "JSON_LD_INVALID",
      page.output,
      script.error ? `Invalid JSON-LD: ${script.error.message}` : "JSON-LD is valid.",
    );
  }
  const nodes = scripts.filter(({ error }) => !error).flatMap(({ nodes: values }) => values);
  const ids = nodes.map((node) => node?.["@id"]).filter(Boolean);
  check(
    report,
    "html",
    ids.length === new Set(ids).size,
    "JSON_LD_DUPLICATE_ID",
    page.output,
    "Top-level JSON-LD nodes contain duplicate @id values.",
  );

  const expectedCanonical = canonicalFor(page);
  for (const webPage of nodes.filter((node) => typeIncludes(node, "WebPage"))) {
    check(
      report,
      "routes",
      !webPage.url || webPage.url === expectedCanonical,
      "SCHEMA_WEBPAGE_URL_MISMATCH",
      page.output,
      "WebPage schema URL must match the canonical manifest URL.",
    );
    check(
      report,
      "routes",
      !webPage.inLanguage || webPage.inLanguage === page.language,
      "SCHEMA_LANGUAGE_MISMATCH",
      page.output,
      "WebPage schema language must match the page manifest.",
    );
  }

  const visible = extractVisibleFaqs(html, page.output);
  const faqNodes = faqSchemaRecord(nodes);
  if (page.faqPage) {
    report.summary.faqPages += 1;
    report.summary.visibleFaqs += visible.length;
    const oneNode = faqNodes.length === 1;
    check(
      report,
      "faq",
      oneNode,
      "FAQPAGE_COUNT",
      page.output,
      "A preserved FAQ schema page must contain exactly one FAQPage node.",
    );
    if (oneNode) {
      const faqId = `${expectedCanonical}#faq`;
      const schema = schemaFaqItems(faqNodes[0]);
      report.summary.schemaFaqs += schema.length;
      check(
        report,
        "faq",
        visible.length > 0,
        "VISIBLE_FAQ_MISSING",
        page.output,
        "FAQPage schema requires a visible FAQ component.",
      );
      check(
        report,
        "faq",
        JSON.stringify(visible.map(({ question, answer }) => ({ question, answer }))) ===
          JSON.stringify(schema),
        "FAQ_SCHEMA_DRIFT",
        page.output,
        "Visible FAQ questions/answers must exactly match FAQPage order and text.",
      );
      check(
        report,
        "faq",
        faqNodes[0]["@id"] === faqId,
        "FAQ_ID_MISMATCH",
        page.output,
        `FAQPage @id must be ${faqId}.`,
      );
      const webPage = nodes.find((node) => typeIncludes(node, "WebPage"));
      const parts = !webPage?.hasPart
        ? []
        : Array.isArray(webPage.hasPart)
          ? webPage.hasPart
          : [webPage.hasPart];
      check(
        report,
        "faq",
        parts.some((part) => part?.["@id"] === faqId),
        "FAQ_HASPART_MISSING",
        page.output,
        "WebPage schema must reference canonical#faq through hasPart.",
      );
    }
  } else {
    check(
      report,
      "faq",
      faqNodes.length === 0,
      "UNEXPECTED_FAQPAGE",
      page.output,
      "FAQPage schema must remain limited to the configured 19-page scope.",
    );
  }
  return { scripts, nodes, visible };
}

async function validateReferences(report, buildDir, generated, fileSet, idsByFile) {
  for (const [output, html] of generated) {
    for (const reference of htmlReferences(html)) {
      const value = reference.value;
      check(
        report,
        "html",
        Boolean(String(value).trim()),
        "EMPTY_REFERENCE",
        output,
        `${reference.tagName}[${reference.attribute}] is empty.`,
      );
      if (!String(value).trim()) continue;
      const cleanPath = String(value).split(/[?#]/)[0].replace(/\\/g, "/");
      check(
        report,
        "html",
        !/(?:^|\/)(?:styles\.css|script\.js)$/i.test(cleanPath),
        "UNSPLIT_GLOBAL_REFERENCE",
        output,
        `Generated page still references unsplit ${cleanPath}.`,
      );
      const target = resolveSiteUrl(value, output, buildDir);
      if (!target) continue;
      check(
        report,
        "html",
        fileSet.has(target.file),
        "LOCAL_TARGET_MISSING",
        output,
        `${value} resolves to missing ${target.file}.`,
      );
      if (target.fragment && target.file.toLowerCase().endsWith(".html")) {
        check(
          report,
          "html",
          idsByFile.get(target.file)?.has(target.fragment),
          "FRAGMENT_TARGET_MISSING",
          output,
          `${value} references missing #${target.fragment}.`,
        );
      }
    }
  }
}

function validateDiscord(report, page, html) {
  const isBusinessPage =
    page.family === PAGE_FAMILIES.home || page.family.startsWith("commercial-");
  const userLinks = [...html.matchAll(/https:\/\/discord\.com\/users\/(\d{15,22})/gi)].map(
    (match) => match[1],
  );
  check(
    report,
    "content",
    userLinks.every((id) => id === DISCORD.userId),
    "DISCORD_ID_DRIFT",
    page.output,
    "Every Discord profile URL must use the configured numeric user ID.",
  );
  const embeddedIdentityNames = [
    DISCORD.username,
    ...(DISCORD.templateUsernames || []),
  ].filter(Boolean);
  const imageSources = getTagEntries(html, "img")
    .map(({ attributes }) => String(attributes.src || ""));
  check(
    report,
    "content",
    imageSources.every((source) =>
      embeddedIdentityNames.every(
        (username) => !new RegExp(escapeRegExp(username), "i").test(source),
      ),
    ),
    "DISCORD_USERNAME_EMBEDDED_ASSET",
    page.output,
    "Generated Discord image filenames must stay username-neutral; CTA copy and accessible identity text come from configuration.",
  );
  if (!isBusinessPage) return;
  check(
    report,
    "content",
    new RegExp(`\\b${escapeRegExp(DISCORD.username)}\\b`, "i").test(html) &&
      html.includes(DISCORD.userId) && html.includes(DISCORD.profileUrl),
    "DISCORD_IDENTITY_MISSING",
    page.output,
    "Business pages must include the configured Discord username, user ID and profile URL.",
  );
}

function validatePaymentPolicy(report, page, html) {
  const localized = PAYMENT_POLICY.fragments[page.language];
  if (!localized) return;
  const plain = toPlainText(html);
  for (const match of html.matchAll(/<p\b[^>]*data-payment-copy="(homepage|faq)\.([a-zA-Z]+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    check(report, "content", toPlainText(match[3]) === toPlainText(localized[match[1]]?.[match[2]] || ""),
      "PAYMENT_SUMMARY_DRIFT", page.output, "Page payment summaries must match the shared homepage policy.");
  }
  if (page.family === PAGE_FAMILIES.home) {
    for (const fragment of collectStrings(localized.homepage)) {
      check(
        report,
        "content",
        plain.includes(toPlainText(fragment)),
        "PAYMENT_POLICY_FRAGMENT_MISSING",
        page.output,
        `Missing configured payment-policy fragment: ${fragment.slice(0, 90)}`,
      );
    }
    if (localized.faq) {
      for (const fragment of collectStrings(localized.faq)) {
        check(
          report,
          "content",
          plain.includes(toPlainText(fragment)),
          "PAYMENT_FAQ_FRAGMENT_MISSING",
          page.output,
          `Missing configured homepage payment FAQ fragment: ${fragment.slice(0, 90)}`,
        );
      }
    }
  }
  const isCommercialPage = page.family.startsWith("commercial-");
  if (page.language === "en" && isCommercialPage && page.server && localized.commercialFaq) {
    const question = formatCommercialPaymentFaqQuestion(page.server);
    const answer = formatCommercialPaymentFaqAnswer(page.server);
    const visibleFaqs = extractVisibleFaqs(html, page.output);
    check(
      report,
      "content",
      visibleFaqs.some((item) => item.question === question && item.answer === answer),
      "COMMERCIAL_PAYMENT_FAQ_DRIFT",
      page.output,
      "Commercial payment FAQ must exactly match the configured policy question and answer.",
    );
  }
}

function validateServerData(report, generated) {
  for (const homePage of pages.filter(({ family }) => family === PAGE_FAMILIES.home)) {
    const home = generated.get(homePage.output);
    if (!home) continue;
    const cards = classElements(home, "article", "server-card");
    check(
      report,
      "content",
      cards.length === SERVER_ORDER.length,
      "SERVER_CARD_COUNT",
      homePage.output,
      `Homepage must contain ${SERVER_ORDER.length} configured server cards.`,
    );
    const cardIds = [];
    for (const [index, serverId] of SERVER_ORDER.entries()) {
      const server = SERVERS[serverId];
      const englishCandidates = commercialPagesForServer(serverId, "en");
      const localizedCandidates = commercialPagesForServer(serverId, homePage.language);
      const englishPage = englishCandidates.length === 1 ? englishCandidates[0] : null;
      const localizedPage = localizedCandidates.length === 1 ? localizedCandidates[0] : null;
      const expectedPage = localizedPage || englishPage;
      const card = cards[index];
      check(
        report,
        "content",
        Boolean(englishPage && expectedPage) && localizedCandidates.length <= 1,
        "SERVER_COMMERCIAL_ROUTE",
        "src/data/pages.mjs",
        `${server.canonicalName} must have one English route and an unambiguous ${homePage.language} target/fallback.`,
      );
      if (!card) continue;
      const anchors = getTagEntries(card.raw, "a");
      const destination = anchors.map(({ attributes }) => attributes.href).find(Boolean) || "";
      const resolved = resolveSiteUrl(destination, homePage.output);
      const resolvedPage = resolved?.file ? pageByOutput[resolved.file] : null;
      cardIds.push(
        resolvedPage?.family.startsWith("commercial-") ? resolvedPage.server : "unknown",
      );
      const plain = toPlainText(card.raw);
      check(
        report,
        "content",
        resolved?.file === expectedPage?.output,
        "SERVER_CARD_TARGET",
        homePage.output,
        `${server.canonicalName} card must target ${expectedPage?.output || "its localized commercial route or English fallback"}.`,
      );
      check(
        report,
        "content",
        serverNameMatches(plain, server),
        "SERVER_CARD_NAME",
        homePage.output,
        `${server.canonicalName} card must use a configured canonical name or alias.`,
      );
      if (server.publishedRate) {
        const localizedMatches = rateMatches(plain, server, homePage.language);
        const wrongLanguage = homePage.language === "es" ? "en" : "es";
        const wrongConnectorMatches = rateMatches(plain, server, wrongLanguage);
        check(
          report,
          "content",
          localizedMatches.length > 0 &&
            localizedMatches.every(
              (match) => Number(match[1]) === server.publishedRate.usd,
            ) &&
            wrongConnectorMatches.length === 0,
          "SERVER_CARD_RATE",
          homePage.output,
          `${server.canonicalName} card must show the configured rate/unit with “${homePage.language === "es" ? "por" : "per"}”.`,
        );
      }
    }
    check(
      report,
      "content",
      arraysEqual(cardIds, SERVER_ORDER),
      "SERVER_CARD_ORDER",
      homePage.output,
      "Homepage server-card order must match the configured supported-server order.",
    );
    const supportedFaq = extractVisibleFaqs(home, homePage.output).find(({ question }) =>
      homePage.language === "es"
        ? /servidores RSPS son compatibles/i.test(question)
        : /RSPS servers are supported/i.test(question),
    );
    check(
      report,
      "content",
      supportedFaq?.answer === formatSupportedServersFaqAnswer(homePage.language),
      "SUPPORTED_SERVERS_FAQ_DRIFT",
      homePage.output,
      "The visible supported-server FAQ answer must be derived exactly from the configured server order, names and other-server policy.",
    );
  }

  for (const page of pages.filter(
    ({ family, server }) => server && family.startsWith("commercial-"),
  )) {
    const html = generated.get(page.output);
    if (!html) continue;
    const server = SERVERS[page.server];
    const plain = visibleBodyText(html);
    check(
      report,
      "content",
      serverNameMatches(plain, server),
      "SERVER_PAGE_NAME",
      page.output,
      "Server page must contain its configured canonical name or alias.",
    );
    if (!server.publishedRate) continue;
    const matches = rateMatches(plain, server, page.language);
    check(
      report,
      "content",
      matches.length > 0,
      "SERVER_PAGE_RATE_MISSING",
      page.output,
      "Server page must contain its configured published rate and unit.",
    );
    for (const match of matches) {
      check(
        report,
        "content",
        Number(match[1]) === server.publishedRate.usd,
        "SERVER_PAGE_RATE_DRIFT",
        page.output,
        `${match[0]} does not match the configured published rate.`,
      );
    }
  }
}

function schemaItemList(nodes) {
  return nodes.find((node) => typeIncludes(node, "ItemList"));
}

function itemListFiles(node, fromFile) {
  return (node?.itemListElement || []).map((entry) =>
    resolveSiteUrl(String(entry.url || entry.item || ""), fromFile)?.file || "",
  );
}

function validateGuideRelationships(report, generated, schemaByPage) {
  const guideHubs = pages.filter(({ family }) => family === PAGE_FAMILIES.guideHub);
  const guideIndex = generated.get("guides.html");
  if (guideIndex) {
    const hubCards = classTags(guideIndex, "a", "guide-card__logo");
    const actual = hubCards.map(({ attributes }) =>
      resolveSiteUrl(attributes.href, "guides.html")?.file || "",
    );
    const expected = guideHubs.map(({ output }) => output);
    check(
      report,
      "guides",
      arraysEqual(actual, expected),
      "GUIDE_INDEX_HUBS",
      "guides.html",
      "Guide index cards must exactly match configured guide hubs and order.",
    );
    const list = schemaItemList(schemaByPage.get("guides.html") || []);
    check(
      report,
      "guides",
      Boolean(list) && arraysEqual(itemListFiles(list, "guides.html"), actual),
      "GUIDE_INDEX_ITEMLIST",
      "guides.html",
      "Guide index ItemList must match visible hub-card order.",
    );

  }

  for (const hub of guideHubs) {
    const html = generated.get(hub.output);
    if (!html) continue;
    const cards = classTags(html, "a", "server-guide-card");
    const actual = cards.map(({ attributes }) =>
      resolveSiteUrl(attributes.href, hub.output)?.file || "",
    );
    const expected = pages
      .filter(
        (page) => page.family === PAGE_FAMILIES.guideArticle && page.server === hub.server,
      )
      .map(({ output }) => output);
    check(
      report,
      "guides",
      actual.length === new Set(actual).size &&
        actual.length === expected.length &&
        expected.every((file) => actual.includes(file)),
      "GUIDE_HUB_CARD_SET",
      hub.output,
      "Guide hub cards must cover every configured article for that server exactly once.",
    );
    check(
      report,
      "guides",
      cards.every(({ attributes }) => Boolean(attributes["data-action"])),
      "GUIDE_CARD_ANALYTICS_HOOK",
      hub.output,
      "Every guide-hub card must retain its data-action hook.",
    );
    const list = schemaItemList(schemaByPage.get(hub.output) || []);
    check(
      report,
      "guides",
      Boolean(list) && arraysEqual(itemListFiles(list, hub.output), actual),
      "GUIDE_HUB_ITEMLIST",
      hub.output,
      "Guide-hub ItemList order must match visible cards.",
    );
  }

  const navigationTargets = [
    "guides.html",
    "impact-guide.html",
    "roat-pkz-guide.html",
    "spawnpk-guide.html",
  ];
  for (const page of pages.filter(({ family }) =>
    [PAGE_FAMILIES.guideIndex, PAGE_FAMILIES.guideHub, PAGE_FAMILIES.guideArticle].includes(family),
  )) {
    const html = generated.get(page.output);
    if (!html) continue;
    const nav = classElements(html, "nav", "guide-header-nav")[0];
    const targets = nav
      ? getTagEntries(nav.raw, "a").map(({ attributes }) =>
          resolveSiteUrl(attributes.href, page.output)?.file || "",
        )
      : [];
    check(
      report,
      "guides",
      arraysEqual(targets, navigationTargets),
      "GUIDE_NAVIGATION",
      page.output,
      "Shared guide navigation must preserve all four configured guide destinations.",
    );
  }

  for (const article of pages.filter(({ family }) => family === PAGE_FAMILIES.guideArticle)) {
    const html = generated.get(article.output);
    if (!html) continue;
    const relatedSections = classElements(html, "section", "related-guides");
    check(
      report,
      "guides",
      relatedSections.length === 1,
      "RELATED_GUIDES_SECTION",
      article.output,
      "Guide article must contain exactly one related-guides section.",
    );
    const cards = relatedSections[0]
      ? classElements(relatedSections[0].raw, "a", "related-guide-card")
      : [];
    const targets = cards.map(({ attributes }) =>
      resolveSiteUrl(attributes.href, article.output)?.file || "",
    );
    check(
      report,
      "guides",
      cards.length >= 3 && cards.length <= 4,
      "RELATED_GUIDE_CARD_COUNT",
      article.output,
      "Related-guides section must retain three or four cards.",
    );
    check(
      report,
      "guides",
      targets.length === new Set(targets).size &&
        !targets.includes(article.output) &&
        targets.every((target) => Boolean(pageByOutput[target])),
      "RELATED_GUIDE_TARGETS",
      article.output,
      "Related-guide targets must be unique, valid and not self-referential.",
    );
    check(
      report,
      "guides",
      cards.every(
        ({ attributes, content }) =>
          Boolean(attributes["data-action"]) &&
          !attributes.target &&
          Boolean(toPlainText(content)),
      ),
      "RELATED_GUIDE_HOOKS",
      article.output,
      "Related-guide cards must retain analytics hooks, visible labels and same-tab behavior.",
    );
    const hub = pages.find(
      (candidate) => candidate.family === PAGE_FAMILIES.guideHub && candidate.server === article.server,
    );
    const contextLink = classTags(html, "a", "guide-context__hub-link")[0];
    check(
      report,
      "guides",
      Boolean(hub) &&
        resolveSiteUrl(contextLink?.attributes.href, article.output)?.file === hub.output,
      "GUIDE_CONTEXT_HUB_LINK",
      article.output,
      "Article guide context must link to its configured server hub.",
    );
  }
}

async function validateSpawnPkFeatures(report, rootDir, buildDir, generated, manifest) {
  // Exercise the request controller using the actual rendered message, not a
  // second hand-authored template. Provenance checks below cover bundle inclusion.
  for (const requestPage of ["spawnpk-gold.html", "es/spawnpk-gold.html"]) {
    const language = requestPage.startsWith("es/") ? "es" : "en";
    const amountLabel = language === "es" ? "Cantidad que necesito:" : "Amount needed:";
    const requestHtml = generated.get(requestPage) || "";
    const rateProbe = renderPublishedRates('<strong data-rate-amount>$9</strong> <span>per 1T</span>',
      { family: "commercial-featured", server: "spawnPk", language },
      { spawnPk: { ...SERVERS.spawnPk, publishedRate: { ...SERVERS.spawnPk.publishedRate, usd: 13 } } }, formatUsdAmount);
    check(report, "features", rateProbe.includes('>$13</strong>'), "SPAWNPK_RATE_CARD_SYNC", requestPage, "A rate change must update the split rate-card markup from shared data.");
    const requestTemplate = decodeHtmlEntities(requestHtml.match(/<pre\b[^>]*id="spawnpk-order-message"[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || "");
    const inputHandlers = {};
    const field = { value: "10", setAttribute(name, value) { this[name] = value; }, addEventListener(name, fn) { inputHandlers[name] = fn; } };
    const preview = { textContent: requestTemplate };
    const finalPreview = { textContent: "" };
    const error = { hidden: true, textContent: decodeHtmlEntities(requestHtml.match(/<p\b[^>]*id="spawnpk-amount-error"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "") };
    const controls = { hidden: true };
    const buttons = [{ disabled: false }, { disabled: false }];
    const presets = [...requestHtml.matchAll(/<button\b[^>]*data-spawnpk-amount="([^"]+)"[^>]*>/g)].map(match => ({
      attributes: parseAttributes(match[0]), handlers: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
      addEventListener(name, fn) { this.handlers[name] = fn; },
    }));
    const previewPanel = { hidden: false };
    const previewToggle = { hidden: true, handlers: {}, setAttribute(name, value) { this[name] = value; }, addEventListener(name, fn) { this.handlers[name] = fn; } };
    const nodes = { "spawnpk-amount": field, "spawnpk-order-message": preview, "spawnpk-final-message": finalPreview, "spawnpk-amount-error": error, "spawnpk-preview-toggle": previewToggle, "spawnpk-message-panel": previewPanel };
    try {
      const runtime = await fs.readFile(path.join(rootDir, "spawnpk-gold.js"), "utf8");
      new VmScript(runtime).runInNewContext({ document: {
        querySelector: () => controls, getElementById: (id) => nodes[id],
        querySelectorAll: (selector) => selector === "[data-spawnpk-amount]" ? presets : buttons,
      } }, { timeout: 1000 });
      for (const [value, expected] of [["25", "25"], ["2,5", "25"], ["0.0001", "25"], ["1000", "1000"], ["1000.0000", "25"], ["1000.0001", "25"], ["1001", "25"], ["1000000", "25"], ["", null], ["0", null], ["1", null], ["4", null], ["5", "5"], ["-2", "25"], ["1e3", "25"], ["<script>", "25"], ["0005", "5"], ["10", "10"]]) {
        field.value = "25";
        inputHandlers.input();
        field.value = value;
        inputHandlers.input();
        const valid = expected !== null;
        check(report, "features", !controls.hidden && error.hidden === valid &&
          /^[0-9]{0,4}$/.test(field.value) && Number(field.value) <= 1000 &&
          finalPreview.textContent === preview.textContent &&
          buttons.every(button => button.disabled === !valid) &&
          (valid ? preview.textContent === requestTemplate.replace(`${amountLabel} 10T`, `${amountLabel} ${expected}T`) && preview.textContent.includes(`${amountLabel} ${expected}T`) : preview.textContent === error.textContent),
        "SPAWNPK_REQUEST_AMOUNT", requestPage, `Request amount ${JSON.stringify(value)} must produce the correct copy state without a stale quantity.`);
      }
      for (const [current, start, end, text, blocked] of [
        ["10", 2, 2, "a", true], ["10", 2, 2, ".", true], ["10", 2, 2, "e", true],
        ["1000", 4, 4, "1", true], ["100", 3, 3, "1", true], ["100", 3, 3, "0", false],
        ["1000", 0, 4, "50", false], ["25", 0, 2, "1001", true],
        ["25", 0, 2, "10000", true], ["25", 0, 2, "2.5", true], ["25", 0, 2, "-2", true],
        ["25", 0, 2, "1e3", true], ["25", 0, 2, " 50 ", true], ["25", 0, 2, "1000", false],
      ]) {
        field.value = current;
        field.selectionStart = start;
        field.selectionEnd = end;
        for (const eventName of ["beforeinput", "paste"]) {
          let prevented = false;
          inputHandlers[eventName]({data:text, clipboardData:{getData:()=>text}, preventDefault(){prevented=true;}});
          check(report, "features", prevented === blocked && field.value === current,
            "SPAWNPK_NUMERIC_INPUT_GUARD", requestPage, `${eventName} must ${blocked ? "reject" : "allow"} ${JSON.stringify(text)} at the selected range without changing its meaning.`);
        }
      }
      check(report, "features", presets.map(button => button.getAttribute("data-spawnpk-amount")).join(",") === "5,10,25,50", "SPAWNPK_PRESET_AMOUNTS", requestPage, "The storefront must offer its four gold-amount shortcuts.");
      const discordLinks = getTagEntries(requestHtml, "a").filter(({ attributes }) => String(attributes.href || "").startsWith("https://discord.com/users/"));
      check(report, "features", discordLinks.length >= 3 && discordLinks.every(({ attributes }) => !attributes.disabled && attributes["aria-disabled"] !== "true"), "SPAWNPK_DIRECT_CONTACT", requestPage, "Direct Discord contact must remain a native link independent of the amount form.");
      check(report, "features", ["spk-safety", "spk-source", "spk-payments"].every(id => requestHtml.includes(`id="${id}"`)) && !/href="#spk-safety">Gold Source/.test(requestHtml), "SPAWNPK_INFORMATION_TARGETS", requestPage, "Payment options, seller identity and gold source must have distinct destinations.");
      for (const button of presets) {
        button.handlers.click();
        check(report, "features", field.value === button.getAttribute("data-spawnpk-amount") &&
          preview.textContent.includes(`${amountLabel} ${field.value}T`) &&
          presets.filter(preset => preset.getAttribute("aria-pressed") === "true").length === 1 &&
          button.getAttribute("aria-pressed") === "true",
        "SPAWNPK_PRESET_SELECTION", requestPage, "A gold-amount shortcut must update both the copy message and the accessible selected state.");
      }
      field.value = "26";
      inputHandlers.input();
      check(report, "features", presets.every(button => button.getAttribute("aria-pressed") === "false"), "SPAWNPK_CUSTOM_AMOUNT", requestPage, "A custom amount must clear the preset selection.");
      check(report, "features", previewPanel.hidden && !previewToggle.hidden && previewToggle["aria-expanded"] === "false", "SPAWNPK_PREVIEW_INITIAL", requestPage, "The enhanced preview starts collapsed without removing the copyable message.");
      previewToggle.handlers.click();
      check(report, "features", !previewPanel.hidden && previewToggle["aria-expanded"] === "true", "SPAWNPK_PREVIEW_OPEN", requestPage, "The message preview must expand accessibly.");
      previewToggle.handlers.click();
      check(report, "features", previewPanel.hidden && previewToggle["aria-expanded"] === "false", "SPAWNPK_PREVIEW_CLOSE", requestPage, "The message preview must collapse accessibly.");
    } catch (error) {
      addIssue(report, "features", "SPAWNPK_REQUEST_RUNTIME", requestPage, error.message);
    }
  }
  for (const [file, contract] of Object.entries(SPAWNPK_FEATURES)) {
    const html = generated.get(file) || "";
    for (const hook of contract.hooks) {
      check(
        report,
        "features",
        new RegExp(`\\b${escapeRegExp(hook)}(?:\\s*=|[\\s>])`, "i").test(html),
        "SPAWNPK_HOOK_MISSING",
        file,
        `Required interactive hook ${hook} is missing.`,
      );
    }
    const record = manifest?.pages?.[file];
    let bundle = "";
    let runtime = "";
    try {
      [bundle, runtime] = await Promise.all([
        fs.readFile(path.join(buildDir, record?.js?.path || ""), "utf8"),
        fs.readFile(path.join(rootDir, contract.script), "utf8"),
      ]);
    } catch (error) {
      addIssue(report, "features", "SPAWNPK_RUNTIME_MISSING", file, error.message);
    }
    check(
      report,
      "features",
      record?.js?.sources?.includes(contract.script) &&
        bundle.includes(
          `/* Page runtime: ${contract.script} */\n${minifyJavaScript(runtime)}`,
        ),
      "SPAWNPK_RUNTIME_PROVENANCE",
      file,
      `Required runtime ${contract.script} must be recorded and embedded with its marker and complete content.`,
    );
    const generatedTargets = htmlReferences(html)
      .map(({ value }) => resolveSiteUrl(value, file, buildDir)?.file)
      .filter(Boolean);
    const separateSources = [
      ...(record?.css?.sources || []),
      ...(record?.js?.sources || []),
    ];
    check(
      report,
      "features",
      separateSources.every((source) => !generatedTargets.includes(source)),
      "SPAWNPK_SEPARATE_ASSET_REFERENCE",
      file,
      "Generated SpawnPK HTML must reference only hashed bundles, not its source page CSS/JavaScript files.",
    );
  }

  const donorFile = "spawnpk-donator-ranks-guide.html";
  const donor = generated.get(donorFile) || "";
  const donorIds = new Set(extractIds(donor).map(({ id }) => id));
  for (const rank of SPAWNPK_RANKS) {
    check(
      report,
      "features",
      donorIds.has(`rank-${rank}`) &&
        donor.includes(`value="${rank}"`) &&
        donor.includes(`assets/spawnpk-ranks/spawnpk-rank-${rank}`),
      "SPAWNPK_RANK_CONTRACT",
      donorFile,
      `SpawnPK ${rank} rank detail, calculator option or local asset is missing.`,
    );
  }
  check(
    report,
    "features",
    (generated.get("spawnpk-starter-guide.html")?.match(/\bdata-checklist-item=/g) || []).length === 12,
    "SPAWNPK_CHECKLIST_CONTRACT",
    "spawnpk-starter-guide.html",
    "SpawnPK starter checklist must retain its 12 interactive actions.",
  );
}

async function validateSitemap(report, buildDir) {
  let source = "";
  try {
    source = await fs.readFile(path.join(buildDir, "sitemap.xml"), "utf8");
  } catch (error) {
    addIssue(report, "routes", "SITEMAP_MISSING", "sitemap.xml", error.message);
    return;
  }
  const records = [...source.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((match) => {
    const block = match[1];
    const location = decodeHtmlEntities(block.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1] || "").trim();
    const alternates = [...block.matchAll(/<xhtml:link\b[^>]*>/gi)].map((link) => {
      const attributes = parseAttributes(link[0]);
      return { language: attributes.hreflang, href: attributes.href };
    });
    const lastModified = block.match(/<lastmod>([^<]+)<\/lastmod>/i)?.[1]?.trim() || null;
    return { location, alternates, lastModified };
  });
  const expectedPages = pages.filter(({ sitemap }) => sitemap);
  const expectedUrls = expectedPages.map(canonicalFor);
  check(
    report,
    "routes",
    arraysEqual(records.map(({ location }) => location), expectedUrls),
    "SITEMAP_URL_PARITY",
    "sitemap.xml",
    "Sitemap URL order and membership must exactly match the page manifest.",
  );
  check(
    report,
    "routes",
    records.length === new Set(records.map(({ location }) => location)).size,
    "SITEMAP_DUPLICATE_URL",
    "sitemap.xml",
    "Sitemap URLs must be unique.",
  );
  for (const [index, page] of expectedPages.entries()) {
    const record = records[index];
    if (!record) continue;
    const cluster = page.translationKey ? translationClusters[page.translationKey] : null;
    const expectedAlternates = cluster
      ? [
          { language: "en", href: canonicalFor(cluster.en) },
          { language: "es", href: canonicalFor(cluster.es) },
          { language: "x-default", href: canonicalFor(cluster.en) },
        ]
      : [];
    check(
      report,
      "routes",
      JSON.stringify(record.alternates) === JSON.stringify(expectedAlternates),
      "SITEMAP_HREFLANG",
      "sitemap.xml",
      `${page.output} sitemap alternates must match its manifest translation cluster.`,
    );
    check(
      report,
      "routes",
      record.lastModified === page.lastModified,
      "SITEMAP_LASTMOD",
      "sitemap.xml",
      `${page.output} sitemap lastmod must be ${page.lastModified}.`,
    );
  }
}

async function validateGeneratedSiteMetadata(report, rootDir, buildDir) {
  const expectedHostname = new URL(site.origin).hostname;
  const expectedSitemap = `${site.origin}/sitemap.xml`;

  let sourceCname = "";
  try {
    sourceCname = (await fs.readFile(path.join(rootDir, "CNAME"), "utf8")).trim();
  } catch (error) {
    addIssue(report, "routes", "SOURCE_CNAME_INVALID", "CNAME", error.message);
  }
  check(
    report,
    "routes",
    sourceCname === expectedHostname,
    "SOURCE_CNAME_CONFIG_DRIFT",
    "CNAME",
    `The GitHub Pages domain marker must match the configured hostname ${expectedHostname}.`,
  );

  let cname = "";
  try {
    cname = (await fs.readFile(path.join(buildDir, "CNAME"), "utf8")).trim();
  } catch (error) {
    addIssue(report, "routes", "CNAME_INVALID", "CNAME", error.message);
  }
  check(
    report,
    "routes",
    cname === expectedHostname,
    "CNAME_CONFIG_DRIFT",
    "CNAME",
    `Generated CNAME must contain only the configured hostname ${expectedHostname}.`,
  );

  let robots = "";
  try {
    robots = await fs.readFile(path.join(buildDir, "robots.txt"), "utf8");
  } catch (error) {
    addIssue(report, "routes", "ROBOTS_INVALID", "robots.txt", error.message);
  }
  const sitemapDirectives = [...robots.matchAll(/^\s*Sitemap:\s*(\S+)\s*$/gim)].map(
    (match) => match[1],
  );
  check(
    report,
    "routes",
    arraysEqual(sitemapDirectives, [expectedSitemap]),
    "ROBOTS_SITEMAP_DRIFT",
    "robots.txt",
    `Generated robots.txt must declare exactly Sitemap: ${expectedSitemap}.`,
  );

  let webManifest = null;
  try {
    webManifest = JSON.parse(
      await fs.readFile(path.join(buildDir, "site.webmanifest"), "utf8"),
    );
  } catch (error) {
    addIssue(report, "routes", "WEBMANIFEST_INVALID", "site.webmanifest", error.message);
  }
  const expectedShortName = site.shortName || site.name;
  check(
    report,
    "routes",
    webManifest?.name === site.name && webManifest?.short_name === expectedShortName,
    "WEBMANIFEST_NAME_DRIFT",
    "site.webmanifest",
    `Generated manifest name/short_name must equal ${site.name}/${expectedShortName} from site config.`,
  );
}

function validateContentAddressedDedupe(report, diskManifest, fileSet) {
  const recordsByType = {
    css: Object.values(diskManifest.pages || {}).map(({ css }) => css).filter(Boolean),
    js: Object.values(diskManifest.pages || {}).map(({ js }) => js).filter(Boolean),
  };
  const pathsByHash = new Map();
  for (const [type, records] of Object.entries(recordsByType)) {
    for (const record of records) {
      const paths = pathsByHash.get(record.hash) || new Set();
      paths.add(record.path);
      pathsByHash.set(record.hash, paths);
      check(
        report,
        "assets",
        record.path === `assets/build/${type}/site.${record.hash}.${type}`,
        "CONTENT_ADDRESSED_BUNDLE_PATH",
        record.path,
        `${type.toUpperCase()} bundle path must be derived only from its content hash.`,
      );
    }
  }
  for (const [hash, paths] of pathsByHash) {
    check(
      report,
      "assets",
      paths.size === 1,
      "HASH_PATH_COLLISION",
      null,
      `Content hash ${hash} maps to multiple paths: ${[...paths].join(", ")}.`,
    );
  }

  for (const [type, records] of Object.entries(recordsByType)) {
    const recordPaths = [...new Set(records.map(({ path: bundlePath }) => bundlePath))]
      .sort(comparePaths);
    const emittedPaths = [...fileSet]
      .filter((file) =>
        new RegExp(`^assets/build/${type}/site\\.[a-f0-9]+\\.${type}$`, "i").test(file),
      )
      .sort(comparePaths);
    const repeatedHashes = new Set(records.map(({ hash }) => hash)).size < records.length;
    check(
      report,
      "assets",
      arraysEqual(emittedPaths, recordPaths),
      "UNREFERENCED_CONTENT_BUNDLE",
      `assets/build/${type}`,
      `Emitted ${type.toUpperCase()} files must exactly equal unique manifest bundle paths.`,
    );
    check(
      report,
      "assets",
      !repeatedHashes || emittedPaths.length < records.length,
      "CONTENT_DEDUPE_INEFFECTIVE",
      `assets/build/${type}`,
      `Repeated ${type.toUpperCase()} hashes must produce fewer files (${emittedPaths.length}) than page records (${records.length}).`,
    );
  }
}

async function validateJavaScriptSyntax(report, rootDir, buildDir) {
  const sourceFiles = (await fs.readdir(rootDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort(comparePaths);
  const emittedFiles = (await discoverFiles(buildDir))
    .filter((file) => file.endsWith(".js"))
    .sort(comparePaths);

  for (const [scope, baseDir, files] of [
    ["source", rootDir, sourceFiles],
    ["emitted", buildDir, emittedFiles],
  ]) {
    for (const file of files) {
      let syntaxValid = false;
      let diagnostic = "";
      try {
        const source = await fs.readFile(path.join(baseDir, file), "utf8");
        new VmScript(source, { filename: file, displayErrors: true });
        syntaxValid = true;
      } catch (error) {
        diagnostic = error.message;
      }
      check(
        report,
        "features",
        syntaxValid,
        "JAVASCRIPT_SYNTAX_ERROR",
        file,
        `${scope} JavaScript must parse with Node/vm without execution.${diagnostic ? ` ${diagnostic}` : ""}`,
      );
    }
  }
}

async function validateCssBlockMarkers(report, rootDir) {
  const css = await fs.readFile(path.join(rootDir, "styles.css"), "utf8");
  const ranges = [...CSS_BLOCKS, COMMERCIAL_CSS_RANGE];
  for (const range of ranges) {
    const status = cssRangeStatus(css, range);
    check(
      report,
      "assets",
      status.startCount === 1,
      "CSS_BLOCK_MARKER_AMBIGUOUS",
      "styles.css",
      `CSS range "${range.key}" start marker must occur exactly once; found ${status.startCount}.`,
    );
    if (range.end !== null) {
      check(
        report,
        "assets",
        status.endCount === 1,
        "CSS_BLOCK_MARKER_AMBIGUOUS",
        "styles.css",
        `CSS range "${range.key}" end marker must occur exactly once; found ${status.endCount}.`,
      );
    }
    check(
      report,
      "assets",
      status.ordered,
      "CSS_BLOCK_RANGE_INVALID",
      "styles.css",
      `CSS range "${range.key}" must have one unambiguous start and end in source order.`,
    );
  }
}

async function validateCssFeatureSlicing(report, rootDir) {
  const css = (await fs.readFile(path.join(rootDir, "styles.css"), "utf8")).replace(
    /\r\n?/g,
    "\n",
  );
  const target = CSS_BLOCKS[0];
  const sentinel = ".probe-card .probe-price";
  const fixture =
    `.probe-card { color: red; }\n.probe-price { color: blue; }\n` +
    css.replace(target.start, `${target.start}\n${sentinel} { color: teal; }`);
  const allFeatures = CSS_BLOCKS.map(({ key }) => key);
  const enabled = createPageCss(fixture, {
    family: PAGE_FAMILIES.home,
    features: { css: allFeatures },
  });
  const disabled = createPageCss(fixture, {
    family: PAGE_FAMILIES.home,
    features: { css: allFeatures.filter((key) => key !== target.key) },
  });
  check(
    report,
    "assets",
    enabled.includes(sentinel) &&
      !disabled.includes(sentinel) &&
      disabled.includes(".probe-card{") &&
      disabled.includes(".probe-price{"),
    "CSS_BLOCK_TREE_SHAKING_UNSAFE",
    "tools/lib/bundles.mjs",
    `Disabling CSS feature "${target.key}" must remove its compound selector while preserving identical class tokens outside the feature range.`,
  );
}

async function validateEmittedDiscordIdentity(report, buildDir) {
  const staleUsernames = (DISCORD.templateUsernames || []).filter(
    (value) => value && value !== DISCORD.username,
  );
  const staleUserIds = [
    ...(DISCORD.templateUserIds || []),
    ...(DISCORD.previousUserIds || []),
  ].filter((value) => value && value !== DISCORD.userId);

  const files = (await discoverFiles(buildDir))
    .filter((file) => file.endsWith(".js"))
    .sort(comparePaths);
  for (const file of files) {
    const source = await fs.readFile(path.join(buildDir, file), "utf8");
    const staleUsername = staleUsernames.find((value) =>
      new RegExp(`(["'\`])${escapeRegExp(value)}\\1`, "i").test(source),
    );
    const staleUserId = staleUserIds.find((value) => source.includes(value));
    check(
      report,
      "content",
      !staleUsername && !staleUserId,
      "EMITTED_DISCORD_IDENTITY_STALE",
      file,
      `Generated JavaScript contains a superseded Discord ${
        staleUsername ? `username "${staleUsername}"` : `user ID "${staleUserId}"`
      }.`,
    );
  }
}

async function validateManifestAndBudgets(
  report,
  rootDir,
  buildResult,
  generated,
  sourceTemplates,
  fileSet,
) {
  const buildDir = buildResult.outputDir;
  const thievingCssFeatures =
    pageByOutput["impact-thieving-guide.html"]?.features.css || [];
  check(
    report,
    "assets",
    thievingCssFeatures.includes("impact-hunter") &&
      thievingCssFeatures.indexOf("impact-hunter") <
        thievingCssFeatures.indexOf("impact-thieving"),
    "FEATURE_DEPENDENCY_MISSING",
    "impact-thieving-guide.html",
    "The Impact thieving bundle must load the shared impact-hunter table styles before its thieving overrides.",
  );
  const roatMoneyCssFeatures =
    pageByOutput["roat-pkz-money-making-guide.html"]?.features.css || [];
  check(
    report,
    "assets",
    roatMoneyCssFeatures.includes("shared-money-calculator"),
    "FEATURE_DEPENDENCY_MISSING",
    "roat-pkz-money-making-guide.html",
    "The Roat PKZ money-making bundle must include the shared money-calculator styles used by its calculator controls.",
  );
  let diskManifest;
  try {
    diskManifest = JSON.parse(await fs.readFile(path.join(buildDir, "build-manifest.json"), "utf8"));
  } catch (error) {
    addIssue(report, "assets", "BUILD_MANIFEST_INVALID", "build-manifest.json", error.message);
    return;
  }
  check(
    report,
    "assets",
    JSON.stringify(diskManifest) === JSON.stringify(buildResult.manifest),
    "BUILD_MANIFEST_DRIFT",
    "build-manifest.json",
    "On-disk build manifest must exactly match the build result.",
  );
  check(
    report,
    "assets",
    arraysEqual(Object.keys(diskManifest.pages), pages.map(({ output }) => output)),
    "BUILD_MANIFEST_PAGES",
    "build-manifest.json",
    "Build-manifest page order and membership must match the source manifest.",
  );
  check(
    report,
    "assets",
    diskManifest.publicPageCount === pages.filter(({ indexable }) => indexable).length,
    "BUILD_MANIFEST_PUBLIC_COUNT",
    "build-manifest.json",
    "Build-manifest public page count is incorrect.",
  );

  const rawCssBytes = (await fs.stat(path.join(rootDir, "styles.css"))).size;
  const rawJsBytes = (await fs.stat(path.join(rootDir, "script.js"))).size;
  const compatibilityScript = await fs.readFile(path.join(buildDir, "script.js"), "utf8");
  check(
    report,
    "content",
    compatibilityScript.includes(
      `var discordUsername = ${JSON.stringify(DISCORD.username)};`,
    ),
    "DISCORD_COMPATIBILITY_DRIFT",
    "script.js",
    "The generated compatibility runtime must use the configured Discord username.",
  );
  check(
    report,
    "assets",
    rawCssBytes <= SOURCE_CSS_UPPER_BOUND,
    "SOURCE_CSS_BUDGET",
    "styles.css",
    `Authoring CSS is ${rawCssBytes} bytes; upper bound is ${SOURCE_CSS_UPPER_BOUND} bytes.`,
  );
  check(
    report,
    "assets",
    rawJsBytes <= SOURCE_JS_UPPER_BOUND,
    "SOURCE_JS_BUDGET",
    "script.js",
    `Authoring JavaScript is ${rawJsBytes} bytes; upper bound is ${SOURCE_JS_UPPER_BOUND} bytes.`,
  );

  const errorRecord = diskManifest.pages["404.html"];
  let errorCss = "";
  try {
    errorCss = await fs.readFile(path.join(buildDir, errorRecord?.css?.path || ""), "utf8");
  } catch (error) {
    addIssue(report, "assets", "ERROR_CSS_MISSING", "404.html", error.message);
  }
  check(
    report,
    "assets",
    Boolean(errorRecord?.css) && errorRecord.css.bytes < 12_000 &&
      !/\.server-card\b|\.guide-layout\b|\.payment-option\b/.test(errorCss),
    "ERROR_CSS_NOT_MINIMAL",
    "404.html",
    "The 404 page must keep its dedicated CSS below 12 KB and exclude commercial, guide and payment selectors.",
  );

  for (const page of pages) {
    const record = diskManifest.pages[page.output];
    const html = generated.get(page.output) || "";
    if (!record) continue;
    check(
      report,
      "assets",
      record.canonical === canonicalFor(page) &&
        record.pathname === page.pathname &&
        record.language === page.language &&
        record.family === page.family &&
        record.server === page.server,
      "PAGE_MANIFEST_METADATA",
      page.output,
      "Generated page manifest metadata must match the route manifest.",
    );
    check(
      report,
      "assets",
      record.faqCount === (page.faqPage ? extractVisibleFaqs(html).length : 0),
      "PAGE_MANIFEST_FAQ_COUNT",
      page.output,
      "Build-manifest FAQ count must match generated visible FAQ data.",
    );

    const sourceReferences = sourceBundleReferences(
      sourceTemplates.get(page.output) || "",
      page,
      rootDir,
    );
    check(
      report,
      "assets",
      Array.isArray(record.css?.sources) &&
        arraysEqual(record.css.sources, sourceReferences.css),
      "CSS_SOURCE_PROVENANCE",
      page.output,
      "CSS manifest sources must exactly match the page-local stylesheets in source order.",
    );
    check(
      report,
      "assets",
      Array.isArray(record.js?.sources || []) &&
        arraysEqual(record.js?.sources || [], sourceReferences.js),
      "JS_SOURCE_PROVENANCE",
      page.output,
      "JavaScript manifest sources must exactly match the page-local runtimes in source order.",
    );

    const cssPath = record.css?.path;
    const cssExists = Boolean(cssPath && fileSet.has(cssPath));
    check(
      report,
      "assets",
      cssExists,
      "CSS_BUNDLE_MISSING",
      page.output,
      `Configured CSS bundle ${cssPath || "(missing)"} does not exist.`,
    );
    if (cssExists) {
      const css = await fs.readFile(path.join(buildDir, cssPath));
      const cssText = css.toString("utf8");
      check(
        report,
        "assets",
        css.length === record.css.bytes &&
          contentHash(css) === record.css.hash &&
          cssPath.includes(`.${record.css.hash}.css`) &&
          JSON.stringify(record.css.features) === JSON.stringify(page.features.css),
        "CSS_MANIFEST_INTEGRITY",
        page.output,
        "CSS bytes, hash, filename or feature list does not match the manifest.",
      );
      check(
        report,
        "assets",
        htmlReferences(html).filter(({ value }) => value === `/${cssPath}`).length === 1,
        "CSS_BUNDLE_REFERENCE",
        page.output,
        "Generated page must load its hashed CSS bundle exactly once.",
      );
      check(
        report,
        "assets",
        arraysEqual(bundleSourceMarkers(cssText, "css"), record.css.sources || []),
        "CSS_BUNDLE_SOURCE_MARKERS",
        page.output,
        "Emitted CSS source markers must exactly match manifest provenance.",
      );
      for (const sourceFile of record.css.sources || []) {
        let sourceText = "";
        try {
          sourceText = await fs.readFile(path.join(rootDir, sourceFile), "utf8");
        } catch (error) {
          addIssue(report, "assets", "CSS_SOURCE_MISSING", sourceFile, error.message);
        }
        check(
          report,
          "assets",
          Boolean(sourceText) &&
            cssText.includes(
              `/* Page stylesheet: ${sourceFile} */\n${expectedBundledCssSource(sourceText)}`,
            ),
          "CSS_SOURCE_CONTENT_MISSING",
          page.output,
          `${sourceFile} must be represented by complete normalized content in the emitted CSS bundle.`,
        );
      }
    }

    if (page.features.js.length) {
      const jsPath = record.js?.path;
      const jsExists = Boolean(jsPath && fileSet.has(jsPath));
      check(
        report,
        "assets",
        jsExists,
        "JS_BUNDLE_MISSING",
        page.output,
        `Configured JavaScript bundle ${jsPath || "(missing)"} does not exist.`,
      );
      if (jsExists) {
        const js = await fs.readFile(path.join(buildDir, jsPath));
        const jsText = js.toString("utf8");
        check(
          report,
          "assets",
          js.length === record.js.bytes &&
            contentHash(js) === record.js.hash &&
            jsPath.includes(`.${record.js.hash}.js`) &&
            JSON.stringify(record.js.features) === JSON.stringify(page.features.js),
          "JS_MANIFEST_INTEGRITY",
          page.output,
          "JavaScript bytes, hash, filename or feature list does not match the manifest.",
        );
        check(
          report,
          "assets",
          htmlReferences(html).filter(({ value }) => value === `/${jsPath}`).length === 1,
          "JS_BUNDLE_REFERENCE",
          page.output,
          "Generated page must load its hashed JavaScript bundle exactly once.",
        );
        check(
          report,
          "assets",
          arraysEqual(bundleSourceMarkers(jsText, "js"), record.js.sources || []),
          "JS_BUNDLE_SOURCE_MARKERS",
          page.output,
          "Emitted JavaScript source markers must exactly match manifest provenance.",
        );
        for (const sourceFile of record.js.sources || []) {
          let sourceText = "";
          try {
            sourceText = await fs.readFile(path.join(rootDir, sourceFile), "utf8");
          } catch (error) {
            addIssue(report, "assets", "JS_SOURCE_MISSING", sourceFile, error.message);
          }
          check(
            report,
            "assets",
            Boolean(sourceText) &&
              jsText.includes(
                `/* Page runtime: ${sourceFile} */\n${minifyJavaScript(sourceText)}`,
              ),
            "JS_SOURCE_CONTENT_MISSING",
            page.output,
            `${sourceFile} must be embedded with complete normalized content in the emitted JavaScript bundle.`,
          );
        }
      }
    } else {
      check(
        report,
        "assets",
        record.js === null,
        "UNEXPECTED_JS_BUNDLE",
        page.output,
        "Page manifest disables global JavaScript but emitted a bundle record.",
      );
    }

    const stylesheetTargets = getTagEntries(html, "link")
      .filter(({ attributes }) =>
        String(attributes.rel || "").toLowerCase().split(/\s+/).includes("stylesheet"),
      )
      .map(({ attributes }) => resolveSiteUrl(attributes.href, page.output)?.file)
      .filter(Boolean);
    const scriptTargets = getTagEntries(html, "script")
      .map(({ attributes }) => resolveSiteUrl(attributes.src, page.output)?.file)
      .filter(Boolean);
    const uniqueStyles = [...new Set(stylesheetTargets)];
    const uniqueScripts = [...new Set(scriptTargets)];
    check(
      report,
      "assets",
      arraysEqual(uniqueStyles, cssPath ? [cssPath] : []),
      "SEPARATE_LOCAL_CSS_REFERENCE",
      page.output,
      "Generated HTML must load only its content-addressed CSS bundle, with no page-local source stylesheet.",
    );
    check(
      report,
      "assets",
      arraysEqual(uniqueScripts, record.js?.path ? [record.js.path] : []),
      "SEPARATE_LOCAL_JS_REFERENCE",
      page.output,
      "Generated HTML must load only its content-addressed JavaScript bundle, with no page-local source runtime.",
    );
    let pageCssBytes = 0;
    let pageJsBytes = 0;
    for (const target of uniqueStyles) {
      if (fileSet.has(target)) pageCssBytes += (await fs.stat(path.join(buildDir, target))).size;
    }
    for (const target of uniqueScripts) {
      if (fileSet.has(target)) pageJsBytes += (await fs.stat(path.join(buildDir, target))).size;
    }
    report.summary.cssBytes += pageCssBytes;
    report.summary.jsBytes += pageJsBytes;
    const home = page.family === PAGE_FAMILIES.home;
    check(
      report,
      "assets",
      pageCssBytes < rawCssBytes && pageCssBytes < (home ? HOME_CSS_BUDGET : OTHER_CSS_BUDGET),
      "CSS_REGRESSION_BUDGET",
      page.output,
      `Loaded CSS is ${pageCssBytes} bytes; budget is below ${Math.min(rawCssBytes, home ? HOME_CSS_BUDGET : OTHER_CSS_BUDGET)} bytes.`,
    );
    check(
      report,
      "assets",
      pageJsBytes < rawJsBytes && pageJsBytes < (home ? HOME_JS_BUDGET : OTHER_JS_BUDGET),
      "JS_REGRESSION_BUDGET",
      page.output,
      `Loaded JavaScript is ${pageJsBytes} bytes; budget is below ${Math.min(rawJsBytes, home ? HOME_JS_BUDGET : OTHER_JS_BUDGET)} bytes.`,
    );
  }

  validateContentAddressedDedupe(report, diskManifest, fileSet);

  const optimizedRecords = Object.entries(diskManifest.optimizedAssets || {});
  check(
    report,
    "assets",
    optimizedRecords.length > 0,
    "OPTIMIZED_ASSET_MANIFEST_EMPTY",
    "build-manifest.json",
    "Optimized-asset manifest must not be empty.",
  );
  const generatedText = [...generated.values()].join("\n") +
    (await Promise.all(
      [...new Set(Object.values(diskManifest.pages).map(({ css }) => css.path))].map((file) =>
        fs.readFile(path.join(buildDir, file), "utf8"),
      ),
    )).join("\n");
  for (const [original, record] of optimizedRecords) {
    const sourceOriginal = path.join(rootDir, original);
    const sourceOptimized = path.join(rootDir, record.output);
    const outputOptimized = path.join(buildDir, record.output);
    let originalBytes = -1;
    let optimizedBytes = -1;
    let copiedHash = "";
    try {
      originalBytes = (await fs.stat(sourceOriginal)).size;
      optimizedBytes = (await fs.stat(sourceOptimized)).size;
      copiedHash = sha256(await fs.readFile(outputOptimized));
    } catch (error) {
      addIssue(report, "assets", "OPTIMIZED_ASSET_MISSING", record.output, error.message);
      continue;
    }
    const sourceHash = sha256(await fs.readFile(sourceOptimized));
    const valid =
      record.originalBytes === originalBytes &&
      record.optimizedBytes === optimizedBytes &&
      record.savedBytes === originalBytes - optimizedBytes &&
      optimizedBytes < originalBytes &&
      copiedHash === sourceHash;
    check(
      report,
      "assets",
      valid,
      "OPTIMIZED_ASSET_INTEGRITY",
      record.output,
      "Optimized asset bytes, savings or copied content do not match the manifest/source.",
    );
    check(
      report,
      "assets",
      generatedText.includes(record.output) && !generatedText.includes(original),
      "OPTIMIZED_ASSET_REFERENCE",
      record.output,
      "Generated HTML/CSS must reference the optimized output and not the replaced original.",
    );
    report.summary.optimizedBytesSaved += originalBytes - optimizedBytes;
  }

  const cssFiles = [...new Set(Object.values(diskManifest.pages).map(({ css }) => css.path))];
  for (const cssFile of cssFiles) {
    const css = await fs.readFile(path.join(buildDir, cssFile), "utf8");
    for (const match of css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
      const target = resolveSiteUrl(match[2], cssFile, buildDir);
      if (!target) continue;
      check(
        report,
        "assets",
        fileSet.has(target.file),
        "CSS_ASSET_MISSING",
        cssFile,
        `CSS url(${match[2]}) resolves to missing ${target.file}.`,
      );
    }
  }
}

async function validateGeneratedSite(report, rootDir, buildResult) {
  const buildDir = buildResult.outputDir;
  const outputFiles = await discoverFiles(buildDir);
  const fileSet = new Set(outputFiles);
  const generatedFiles = discoverHtmlFiles(buildDir).sort(comparePaths);
  const expectedFiles = pages.map(({ output }) => output).sort(comparePaths);
  report.summary.generatedPages = generatedFiles.length;
  check(
    report,
    "build",
    arraysEqual(generatedFiles, expectedFiles),
    "GENERATED_PAGE_MANIFEST_MISMATCH",
    null,
    `Generated HTML inventory must exactly match the ${expectedFiles.length}-page manifest.`,
  );

  const generated = new Map();
  const sources = new Map();
  const idsByFile = new Map();
  const schemaByPage = new Map();
  for (const page of pages) {
    try {
      const [html, source] = await Promise.all([
        fs.readFile(path.join(buildDir, page.output), "utf8"),
        fs.readFile(path.join(rootDir, page.source), "utf8"),
      ]);
      generated.set(page.output, html);
      sources.set(page.output, source);
      idsByFile.set(page.output, new Set(extractIds(html).map(({ id }) => id)));
    } catch (error) {
      addIssue(report, "build", "GENERATED_PAGE_MISSING", page.output, error.message);
    }
  }

  for (const page of pages) {
    const html = generated.get(page.output);
    const source = sources.get(page.output);
    if (!html || !source) continue;
    validateHeadingAndHookPreservation(report, page, source, html);
    validatePageAccessibility(report, page, html, idsByFile.get(page.output));
    validateAnalytics(report, page, html);
    validateReputation(report, page, html);
    validatePageRoutes(report, page, html);
    validateErrorPageReferences(report, page, html);
    const schema = validateJsonLdAndFaq(report, page, html);
    schemaByPage.set(page.output, schema.nodes);
    validateDiscord(report, page, html);
    validatePaymentPolicy(report, page, html);

    const htmlWithoutNoscriptFallbacks = html.replace(
      /<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi,
      "",
    );
    check(
      report,
      "html",
      !/<style\b/i.test(htmlWithoutNoscriptFallbacks),
      "INLINE_STYLE_REMAINS",
      page.output,
      "Generated pages must not retain inline style blocks outside a no-JavaScript fallback.",
    );
    for (const script of getTagEntries(html, "script")) {
      const type = String(script.attributes.type || "").toLowerCase();
      const allowedInline = type === "application/ld+json" || type === "application/json";
      check(
        report,
        "html",
        Boolean(script.attributes.src) || allowedInline,
        "INLINE_RUNTIME_REMAINS",
        page.output,
        "Generated pages may only retain inline JSON/JSON-LD scripts.",
      );
    }
    check(
      report,
      "html",
      !/__RSPS_[A-Z0-9_]+__|(?:href|src|content)=["'][^"']*undefined/gi.test(html),
      "UNRESOLVED_BUILD_TOKEN",
      page.output,
      "Generated HTML contains an unresolved build token/value.",
    );
  }

  await validateReferences(report, buildDir, generated, fileSet, idsByFile);
  validateServerData(report, generated);
  validateGuideRelationships(report, generated, schemaByPage);
  await validateSpawnPkFeatures(
    report,
    rootDir,
    buildDir,
    generated,
    buildResult.manifest,
  );
  await validateGeneratedSiteMetadata(report, rootDir, buildDir);
  await validateSitemap(report, buildDir);
  await validateCssBlockMarkers(report, rootDir);
  await validateCssFeatureSlicing(report, rootDir);
  await validateJavaScriptSyntax(report, rootDir, buildDir);
  await validateEmittedDiscordIdentity(report, buildDir);
  await validateManifestAndBudgets(
    report,
    rootDir,
    buildResult,
    generated,
    sources,
    fileSet,
  );
}

/**
 * Builds and validates the complete static site without mutating the repository.
 * All diagnostics are returned as structured issue records for CLI and tests.
 */
export async function validateSite({ rootDir = projectRoot } = {}) {
  const root = path.resolve(rootDir);
  const report = newReport(root);
  const temporaryDirectories = [];

  try {
    await validateInventory(report, root);
    await validatePackageMetadata(report, root);
    await validateWorkflow(report, root);
    validateFocusedMutations(report);
    await validateSafeOutputGuard(report, root, temporaryDirectories);
    const builds = await runBuilds(report, root, temporaryDirectories);
    if (builds.first) await validateGeneratedSite(report, root, builds.first);
  } catch (error) {
    addIssue(report, "build", "VALIDATOR_EXCEPTION", null, error.stack || error.message);
  } finally {
    for (const directory of temporaryDirectories) {
      try {
        await fs.rm(directory, { recursive: true, force: true });
      } catch (error) {
        addIssue(
          report,
          "build",
          "TEMP_CLEANUP_FAILED",
          toPosixPath(directory),
          error.message,
        );
      }
    }
  }

  report.ok = report.issues.length === 0;
  return report;
}

function printReport(report) {
  for (const [key] of GROUPS) {
    const group = report.groups[key];
    const status = group.issues ? "FAIL" : "PASS";
    console.log(`${status} ${group.label}: ${group.checks} checks, ${group.issues} issues`);
    for (const issue of report.issues.filter((entry) => entry.group === key)) {
      console.error(`  [${issue.code}]${issue.file ? ` ${issue.file}:` : ""} ${issue.message}`);
    }
  }
  console.log(
    `Summary: ${report.summary.sourcePages} source pages, ${report.summary.generatedPages} generated pages, ` +
      `${report.summary.faqPages} FAQPage documents (${report.summary.schemaFaqs} schema answers), ` +
      `${report.summary.optimizedBytesSaved.toLocaleString("en-US")} optimized-image bytes saved.`,
  );
  console.log(report.ok ? "Validation passed." : `Validation failed with ${report.issues.length} issue(s).`);
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (invokedAsScript) {
  const report = await validateSite();
  printReport(report);
  if (!report.ok) process.exitCode = 1;
}
