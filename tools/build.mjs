import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ANALYTICS,
  PAYMENT_POLICY,
  REPUTATION,
  SERVERS,
  DISCORD,
  UI_COPY,
  formatCommercialPaymentFaqAnswer,
  formatCommercialPaymentFaqQuestion,
  formatReputationText,
  formatSupportedServersFaqAnswer,
  formatUsdAmount,
  site,
} from "../src/data/site.mjs";
import { pages, translationClusters } from "../src/data/pages.mjs";
import { parseAttributes, resolveLocalUrl } from "../scripts/lib/html.mjs";
import { createPageCss, createPageJs } from "./lib/bundles.mjs";
import {
  extractInlineHeadStyles,
  extractInlineRuntimeScripts,
  renderAnalytics,
  renderCanonicalAndLanguages,
  renderDiscordIdentity,
  renderPaymentPolicy,
  renderPublishedRates,
  renderReputation,
  renderSkipLink,
  renderSupportedServersFaq,
  rewriteGlobalScript,
  rewriteGlobalStylesheet,
  rewriteOptimizedImageSources,
  synchronizeJsonLd,
} from "./lib/html-render.mjs";
import {
  contentHash,
  copyTree,
  discoverFiles,
  normalizeGeneratedText,
  recreateDirectory,
  sha256,
  writeText,
} from "./lib/files.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const OPTIMIZED_IMAGES = Object.freeze({
  "assets/spawnpk-sales/spk-a6cdeb9f88b8.webp": {
    path: "assets/spawnpk-sales/cash-bag-396.webp", width: 396, height: 404,
  },
  "assets/spawnpk-sales/spk-ea3e6a08cea4.webp": {
    path: "assets/spawnpk-sales/unholy-behemoth-720.webp", width: 720, height: 469,
    variants: [{ path: "assets/spawnpk-sales/unholy-behemoth-480.webp", width: 480 }],
    sizes: "(max-width: 680px) 80vw, 360px",
  },
  "assets/spawnpk-sales/spk-5edd029b92ba.webp": {
    path: "assets/spawnpk-sales/bloodrend-720.webp", width: 720, height: 912,
    variants: [{ path: "assets/spawnpk-sales/bloodrend-480.webp", width: 480 }],
    sizes: "(max-width: 680px) 40vw, 180px",
  },
  "assets/spawnpk-sales/spk-468ea26acabd.webp": {
    path: "assets/spawnpk-sales/webweaver-720.webp", width: 720, height: 854,
    variants: [{ path: "assets/spawnpk-sales/webweaver-480.webp", width: 480 }],
    sizes: "(max-width: 680px) 40vw, 180px",
  },
  "assets/spawnpk-sales/spk-cd400b427902.webp": {
    path: "assets/spawnpk-sales/tumekens-shadow-720.webp", width: 720, height: 678,
    variants: [{ path: "assets/spawnpk-sales/tumekens-shadow-480.webp", width: 480 }],
    sizes: "(max-width: 680px) 80vw, 360px",
  },

  "assets/rsps-adventure-background.png": {
    path: "assets/rsps-adventure-background.webp",
    width: 1672,
    height: 941,
  },
  "assets/images/wide_bright_medieval_fantasy_runescape_style_vill.png": {
    path: "assets/images/wide_bright_medieval_fantasy_runescape_style_vill.webp",
    width: 1914,
    height: 822,
  },
  "assets/rsps-gold-hub-logo.png": {
    path: "assets/rsps-gold-hub-logo.webp",
    width: 776,
    height: 305,
  },
  "assets/add-a6d9-discord-button.png": {
    path: "assets/discord-contact-button-v2.webp",
    width: 1536,
    height: 1024,
  },
  "assets/a6d9-avatar.png": {
    path: "assets/discord-profile-avatar.webp",
    width: 150,
    height: 150,
  },
  "assets/alora-logo.png": {
    path: "assets/alora-logo.webp",
    width: 1082,
    height: 281,
    variants: [
      { path: "assets/alora-logo-320.webp", width: 320 },
      { path: "assets/alora-logo-640.webp", width: 640 },
    ],
    sizes: "(max-width: 600px) 44vw, 280px",
  },
  "assets/orion-logo.png": {
    path: "assets/orion-logo.webp",
    width: 800,
    height: 375,
    variants: [
      { path: "assets/orion-logo-320.webp", width: 320 },
      { path: "assets/orion-logo-640.webp", width: 640 },
    ],
    sizes: "(max-width: 600px) 44vw, 280px",
  },
  "assets/other-rsps-logo.png": {
    path: "assets/other-rsps-logo.webp",
    width: 850,
    height: 185,
    variants: [
      { path: "assets/other-rsps-logo-320.webp", width: 320 },
      { path: "assets/other-rsps-logo-640.webp", width: 640 },
    ],
    sizes: "(max-width: 600px) 44vw, 280px",
  },
  "assets/roat-pkz-logo.png": {
    path: "assets/roat-pkz-logo.webp",
    width: 497,
    height: 300,
    variants: [{ path: "assets/roat-pkz-logo-240.webp", width: 240 }],
    sizes: "(max-width: 600px) 44vw, 280px",
  },
  "assets/runex-logo.png": {
    path: "assets/runex-logo.webp",
    width: 576,
    height: 278,
    variants: [
      { path: "assets/runex-logo-240.webp", width: 240 },
    ],
    sizes: "(max-width: 600px) 44vw, 280px",
  },
  "assets/ferox-logo.png": {
    path: "assets/ferox-logo.webp",
    width: 448,
    height: 284,
    variants: [{ path: "assets/ferox-logo-240.webp", width: 240 }],
    sizes: "(max-width: 600px) 44vw, 280px",
  },
  "assets/near-reality-logo.png": {
    path: "assets/near-reality-logo.webp",
    width: 695,
    height: 259,
    variants: [
      { path: "assets/near-reality-logo-240.webp", width: 240 },
      { path: "assets/near-reality-logo-480.webp", width: 480 },
    ],
    sizes: "(max-width: 600px) 44vw, 280px",
  },
  "assets/payment-icons/rs3-logo.png": {
    path: "assets/payment-icons/rs3-logo.webp",
    width: 624,
    height: 220,
  },
});

const commercialOutputByServer = Object.freeze(
  Object.fromEntries(
    pages
      .filter(
        (page) =>
          page.language === "en" &&
          page.family.startsWith("commercial-") &&
          page.server,
      )
      .map((page) => [page.server, page.output]),
  ),
);

const reputationTextByLanguage = Object.freeze(
  Object.fromEntries(["en", "es"].map((language) => [language, formatReputationText(language)])),
);

export function renderCompatibilityScript(source, discord) {
  return String(source).replace(
    /var discordUsername = ["'][^"']+["'];/,
    `var discordUsername = ${JSON.stringify(discord.username)};`,
  );
}

export function assertAuthoredJavaScriptIsEnabled(page, pageScripts, inlineScripts) {
  if (page.features.js.length || (!pageScripts.js.trim() && !inlineScripts.js.trim())) return;
  throw new Error(
    `${page.source}: manifest disables JavaScript but the source contains page-local or inline JavaScript`,
  );
}

function canonicalUrl(page) {
  return `${site.origin}${page.pathname}`;
}

function translationsFor(page) {
  if (!page.translationKey) return [page];
  const cluster = translationClusters[page.translationKey];
  return [cluster.en, cluster.es];
}

function defaultTranslationFor(page) {
  return page.translationKey ? translationClusters[page.translationKey].en : page;
}

function publicPath(page) {
  return page.pathname;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createSitemap() {
  const records = pages.filter((page) => page.sitemap);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];
  for (const page of records) {
    lines.push("  <url>", `    <loc>${xmlEscape(canonicalUrl(page))}</loc>`);
    const translations = translationsFor(page);
    if (translations.length > 1) {
      for (const alternate of translations) {
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${alternate.language}" href="${xmlEscape(canonicalUrl(alternate))}" />`,
        );
      }
      lines.push(
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(canonicalUrl(defaultTranslationFor(page)))}" />`,
      );
    }
    if (page.lastModified) lines.push(`    <lastmod>${page.lastModified}</lastmod>`);
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  return lines.join("\n");
}

function addHomepageImagePreload(html, page) {
  if (page.family !== "home") return html;
  const preload =
    '    <link rel="preload" as="image" href="/assets/images/wide_bright_medieval_fantasy_runescape_style_vill.webp" type="image/webp" fetchpriority="high" />';
  return html.replace(/<\/head>/i, `${preload}\n  </head>`);
}

async function extractPageStylesheets(html, page, rootDir) {
  const files = [];
  const rendered = html.replace(/\s*<link\b[^>]*>\s*/gi, (tag) => {
    const attributes = parseAttributes(tag);
    const relations = String(attributes.rel || "").toLowerCase().split(/\s+/);
    if (!relations.includes("stylesheet")) return tag;
    const resolved = resolveLocalUrl(attributes.href, page.source, rootDir);
    if (!resolved || resolved.file === "styles.css" || !resolved.file.endsWith(".css")) {
      return tag;
    }
    files.push(resolved.file);
    return "\n";
  });
  const chunks = [];
  for (const file of [...new Set(files)]) {
    chunks.push(
      `/* Page stylesheet: ${file} */\n${(await fs.readFile(path.join(rootDir, file), "utf8")).replace(/\r\n?/g, "\n").trim()}`,
    );
  }
  return { html: rendered, css: chunks.join("\n\n"), files: [...new Set(files)] };
}

async function extractPageScripts(html, page, rootDir) {
  const files = [];
  const rendered = html.replace(
    /\s*<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*><\/script>\s*/gi,
    (tag) => {
      const openingTag = tag.slice(tag.indexOf("<script"), tag.indexOf(">") + 1);
      const attributes = parseAttributes(openingTag);
      const resolved = resolveLocalUrl(attributes.src, page.source, rootDir);
      if (!resolved || resolved.file === "script.js" || !resolved.file.endsWith(".js")) {
        return tag;
      }
      files.push(resolved.file);
      return "\n";
    },
  );
  const chunks = [];
  for (const file of [...new Set(files)]) {
    chunks.push(
      `/* Page runtime: ${file} */\n${(await fs.readFile(path.join(rootDir, file), "utf8")).replace(/\r\n?/g, "\n").trim()}`,
    );
  }
  return { html: rendered, js: chunks.join("\n\n"), files: [...new Set(files)] };
}

async function copyRootRuntimeFiles(rootDir, outputDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (!entry.isFile()) continue;
    const isPageCss = entry.name.endsWith(".css") && entry.name !== "styles.css";
    const isPageJs = entry.name.endsWith(".js") && entry.name !== "script.js";
    if (!isPageCss && !isPageJs) continue;
    await fs.copyFile(path.join(rootDir, entry.name), path.join(outputDir, entry.name));
  }
}

async function copyStaticFiles(rootDir, outputDir, discord) {
  await copyTree(path.join(rootDir, "assets"), path.join(outputDir, "assets"));
  await copyRootRuntimeFiles(rootDir, outputDir);
  await fs.copyFile(path.join(rootDir, "styles.css"), path.join(outputDir, "styles.css"));
  const compatibilityScript = renderCompatibilityScript(
    await fs.readFile(path.join(rootDir, "script.js"), "utf8"),
    discord,
  );
  await writeText(path.join(outputDir, "script.js"), compatibilityScript);
  await fs.writeFile(path.join(outputDir, ".nojekyll"), "", "utf8");
}

async function writeSiteMetadata(rootDir, outputDir) {
  const origin = new URL(site.origin);
  const sourceManifest = JSON.parse(
    await fs.readFile(
      path.join(rootDir, "src", "templates", "site.webmanifest.json"),
      "utf8",
    ),
  );
  const webManifest = {
    ...sourceManifest,
    name: site.name,
    short_name: site.name,
    start_url: "/",
    scope: "/",
  };
  await writeText(path.join(outputDir, "CNAME"), origin.hostname);
  await writeText(
    path.join(outputDir, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml`,
  );
  await writeText(
    path.join(outputDir, "site.webmanifest"),
    JSON.stringify(webManifest, null, 2),
  );
}

async function sourceDigest(rootDir) {
  const rootRuntimeFiles = (await fs.readdir(rootDir, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        ((entry.name.endsWith(".css") && entry.name !== "styles.css") ||
          (entry.name.endsWith(".js") && entry.name !== "script.js")),
    )
    .map((entry) => entry.name);
  const assetInputs = (await discoverFiles(path.join(rootDir, "assets"))).map(
    (relative) => `assets/${relative}`,
  );
  const inputs = [...new Set([
    "styles.css",
    "src/styles/error-page.css",
    "script.js",
    "src/templates/site.webmanifest.json",
    "src/styles/discord-identity.css",
    "src/data/site.mjs",
    "src/data/pages.mjs",
    "scripts/lib/html.mjs",
    "tools/build.mjs",
    "tools/lib/bundles.mjs",
    "tools/lib/files.mjs",
    "tools/lib/html-render.mjs",
    ...pages.map(({ source }) => source),
    ...rootRuntimeFiles,
    ...assetInputs,
  ])].sort();
  const textExtensions = new Set([
    ".css",
    ".html",
    ".js",
    ".json",
    ".mjs",
    ".svg",
    ".txt",
    ".webmanifest",
    ".xml",
  ]);
  const parts = [];
  for (const input of inputs) {
    const bytes = await fs.readFile(path.join(rootDir, input));
    const digestInput = textExtensions.has(path.extname(input).toLowerCase())
      ? bytes.toString("utf8").replace(/\r\n?/g, "\n")
      : bytes;
    parts.push(`${input}\0${sha256(digestInput)}\n`);
  }
  return sha256(parts.join(""));
}

async function optimizedAssetStats(rootDir) {
  const stats = {};
  for (const [original, optimized] of Object.entries(OPTIMIZED_IMAGES)) {
    const originalBytes = (await fs.stat(path.join(rootDir, original))).size;
    const optimizedBytes = (await fs.stat(path.join(rootDir, optimized.path))).size;
    stats[original] = {
      output: optimized.path,
      originalBytes,
      optimizedBytes,
      savedBytes: originalBytes - optimizedBytes,
    };
  }
  return stats;
}

export async function buildSite({
  rootDir = projectRoot,
  outputDir = path.join(rootDir, "dist"),
  quiet = false,
} = {}) {
  const root = path.resolve(rootDir);
  const output = await recreateDirectory(root, outputDir);
  await copyStaticFiles(root, output, DISCORD);
  await writeSiteMetadata(root, output);

  const globalCss = await fs.readFile(path.join(root, "styles.css"), "utf8");
  const errorPageCss = await fs.readFile(
    path.join(root, "src", "styles", "error-page.css"),
    "utf8",
  );
  const discordIdentityCss = await fs.readFile(
    path.join(root, "src", "styles", "discord-identity.css"),
    "utf8",
  );
  const globalJs = await fs.readFile(path.join(root, "script.js"), "utf8");
  const manifestPages = {};

  for (const page of pages) {
    let html = (await fs.readFile(path.join(root, page.source), "utf8")).replace(/\r\n?/g, "\n");
    // Reputation must be materialized while its progressive-enhancement script
    // is still present. Extracted runtime is deliberately opaque to renderers.
    html = renderReputation(html, page, REPUTATION, reputationTextByLanguage);
    html = renderAnalytics(html, ANALYTICS);
    html = renderSkipLink(html, page, UI_COPY);
    const pageStyles = await extractPageStylesheets(html, page, root);
    html = pageStyles.html;
    const inlineStyles = extractInlineHeadStyles(html);
    html = inlineStyles.html;
    const pageScripts = await extractPageScripts(html, page, root);
    html = pageScripts.html;
    const inlineScripts = extractInlineRuntimeScripts(html);
    html = inlineScripts.html;

    assertAuthoredJavaScriptIsEnabled(page, pageScripts, inlineScripts);

    html = renderDiscordIdentity(html, DISCORD);
    html = renderPublishedRates(
      html,
      page,
      SERVERS,
      formatUsdAmount,
      commercialOutputByServer,
    );
    html = renderPaymentPolicy(html, page, PAYMENT_POLICY, {
      formatCommercialPaymentFaqAnswer,
      formatCommercialPaymentFaqQuestion,
    });
    html = renderSupportedServersFaq(
      html,
      page,
      formatSupportedServersFaqAnswer(page.language),
    );

    const canonicalResult = renderCanonicalAndLanguages(html, page, {
      canonicalUrl,
      translationsFor,
      defaultTranslationFor,
      publicPath,
    });
    html = canonicalResult.html;
    const jsonLdResult = synchronizeJsonLd(html, page, {
      canonical: canonicalResult.canonical,
      previousCanonical: canonicalResult.previousCanonical,
      discord: DISCORD,
    });
    html = rewriteOptimizedImageSources(jsonLdResult.html, OPTIMIZED_IMAGES);

    const combinedPageCss = [
      pageStyles.css,
      inlineStyles.css,
      html.includes("discord-image-cta") ? discordIdentityCss : "",
    ].filter(Boolean).join("\n\n");
    const authoringCss = page.family === "error" ? errorPageCss : globalCss;
    const css = normalizeGeneratedText(createPageCss(authoringCss, page, combinedPageCss));
    const cssHash = contentHash(css);
    const cssRelative = `assets/build/css/site.${cssHash}.css`;
    await writeText(path.join(output, cssRelative), css);
    html = rewriteGlobalStylesheet(html, `/${cssRelative}`);

    let jsRecord = null;
    if (page.features.js.length) {
      const combinedPageJs = [pageScripts.js, inlineScripts.js].filter(Boolean).join("\n\n");
      const js = normalizeGeneratedText(createPageJs(globalJs, page, DISCORD, combinedPageJs));
      const jsHash = contentHash(js);
      const jsRelative = `assets/build/js/site.${jsHash}.js`;
      await writeText(path.join(output, jsRelative), js);
      const rewrittenScript = rewriteGlobalScript(html, `/${jsRelative}`);
      if (!rewrittenScript.replaced) {
        throw new Error(`${page.source}: manifest expects JavaScript but source has no script.js`);
      }
      html = rewrittenScript.html;
      jsRecord = {
        path: jsRelative,
        bytes: Buffer.byteLength(js),
        hash: jsHash,
        features: page.features.js,
        sources: pageScripts.files,
      };
    } else {
      const scriptResult = rewriteGlobalScript(html, "");
      if (scriptResult.replaced) {
        throw new Error(`${page.source}: manifest disables JavaScript but source loads script.js`);
      }
    }

    html = addHomepageImagePreload(html, page);
    await writeText(path.join(output, page.output), html);
    manifestPages[page.output] = {
      pathname: page.pathname,
      canonical: canonicalResult.canonical,
      language: page.language,
      family: page.family,
      server: page.server,
      faqCount: jsonLdResult.faqCount,
      css: {
        path: cssRelative,
        bytes: Buffer.byteLength(css),
        hash: cssHash,
        features: page.features.css,
        sources: pageStyles.files,
      },
      js: jsRecord,
    };
  }

  await writeText(path.join(output, "sitemap.xml"), createSitemap());
  const manifest = {
    version: 1,
    sourceDigest: await sourceDigest(root),
    publicPageCount: pages.filter(({ indexable }) => indexable).length,
    pages: manifestPages,
    optimizedAssets: await optimizedAssetStats(root),
  };
  await writeText(path.join(output, "build-manifest.json"), JSON.stringify(manifest, null, 2));

  if (!quiet) {
    const cssBytes = Object.values(manifestPages).reduce((sum, record) => sum + record.css.bytes, 0);
    const jsBytes = Object.values(manifestPages).reduce((sum, record) => sum + (record.js?.bytes || 0), 0);
    console.log(
      `Built ${pages.length} pages in ${output} (${cssBytes.toLocaleString("en-US")} CSS bytes, ${jsBytes.toLocaleString("en-US")} JavaScript bytes across page bundles).`,
    );
  }
  return { outputDir: output, manifest };
}

function parseCliOutput(args) {
  const inline = args.find((argument) => argument.startsWith("--out="));
  if (inline) return path.resolve(inline.slice("--out=".length));
  const index = args.indexOf("--out");
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : null;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;
if (invokedAsScript) {
  const requestedOutput = parseCliOutput(process.argv.slice(2));
  await buildSite({
    rootDir: projectRoot,
    outputDir: requestedOutput || path.join(projectRoot, "dist"),
  });
}
