import {
  extractVisibleFaqs,
  parseAttributes,
  parseJsonLdScripts,
  scanHtmlTags,
} from "../../scripts/lib/html.mjs";

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function typeIncludes(node, expected) {
  return (
    node?.["@type"] === expected ||
    (Array.isArray(node?.["@type"]) && node["@type"].includes(expected))
  );
}

function flattenNodes(value) {
  if (Array.isArray(value?.["@graph"])) return value["@graph"];
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? [value] : [];
}

function replaceStrings(value, replacer) {
  if (typeof value === "string") return replacer(value);
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, replacer));
  if (!value || typeof value !== "object") return value;
  for (const [key, child] of Object.entries(value)) {
    value[key] = replaceStrings(child, replacer);
  }
  return value;
}

export function setTagAttribute(tag, name, value) {
  const escaped = escapeAttribute(value);
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`, "i");
  if (pattern.test(tag)) return tag.replace(pattern, `$1"${escaped}"`);
  return tag.replace(/\s*\/?>$/, (ending) => ` ${name}="${escaped}"${ending}`);
}

export function extractInlineHeadStyles(html) {
  const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) return { html, css: "" };

  const styles = [];
  const rewrittenHead = headMatch[0].replace(
    /<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>|\s*<style\b([^>]*)>([\s\S]*?)<\/style>\s*/gi,
    (match, attributes, css) => {
      // A no-JavaScript fallback must not become unconditional bundle CSS.
      if (css === undefined) return match;
      const attrs = parseAttributes(`<style${attributes}>`);
      if (attrs.media) {
        styles.push(`@media ${attrs.media} {\n${css.trim()}\n}`);
      } else {
        styles.push(css.trim());
      }
      return "\n";
    },
  );

  return {
    html: html.slice(0, headMatch.index) + rewrittenHead + html.slice(headMatch.index + headMatch[0].length),
    css: styles.filter(Boolean).join("\n\n"),
  };
}

export function extractInlineRuntimeScripts(html) {
  const scripts = [];
  const rewritten = html.replace(
    /\s*<script\b([^>]*)>([\s\S]*?)<\/script>\s*/gi,
    (match, attributes, source) => {
      const attrs = parseAttributes(`<script${attributes}>`);
      const type = String(attrs.type || "").trim().toLowerCase();
      if (
        attrs.src ||
        (type && !["text/javascript", "application/javascript", "module"].includes(type))
      ) {
        return match;
      }
      scripts.push(source.trim());
      return "\n";
    },
  );
  return { html: rewritten, js: scripts.filter(Boolean).join("\n\n") };
}

export function renderAnalytics(html, analytics) {
  if (!analytics?.scriptUrl || !analytics?.domain) return html;
  const withoutExisting = html.replace(
    /\s*<script\b(?=[^>]*\bdata-rsps-analytics\b)[^>]*><\/script>\s*/gi,
    "\n",
  );
  const tag = `<script defer data-rsps-analytics data-domain="${escapeAttribute(analytics.domain)}" src="${escapeAttribute(analytics.scriptUrl)}"></script>`;
  if (!/<\/head>/i.test(withoutExisting)) throw new Error("Page is missing a closing head element");
  return withoutExisting.replace(/<\/head>/i, `  ${tag}\n  </head>`);
}

export function renderSkipLink(html, page, uiCopy) {
  const text = uiCopy?.[page.language]?.skipToContent;
  if (!text) throw new Error(`${page.source}: missing localized skip-link copy`);

  let rendered = html.replace(
    /\s*<a\b(?=[^>]*\bclass=["'][^"']*\bskip-link\b[^"']*["'])[^>]*>[\s\S]*?<\/a>\s*/gi,
    "\n",
  );
  const mainTag = rendered.match(/<main\b[^>]*>/i)?.[0];
  if (!mainTag) throw new Error(`${page.source}: missing main element for skip-link target`);
  const mainId = parseAttributes(mainTag).id || "main";
  if (!parseAttributes(mainTag).id) {
    rendered = rendered.replace(mainTag, setTagAttribute(mainTag, "id", mainId));
  }

  const link = `<a class="skip-link" href="#${escapeAttribute(mainId)}">${escapeHtmlText(text)}</a>`;
  if (!/<body\b[^>]*>/i.test(rendered)) throw new Error(`${page.source}: missing body element`);
  return rendered.replace(/<body\b[^>]*>/i, (tag) => `${tag}\n    ${link}`);
}

function replaceReputationText(html, key, value) {
  const escapedKey = escapeRegExp(key);
  const pattern = new RegExp(
    `(<([a-z][\\w:-]*)\\b(?=[^>]*\\bdata-reputation-text=["']${escapedKey}["'])[^>]*>)[\\s\\S]*?(<\\/\\2>)`,
    "gi",
  );
  let matches = 0;
  const rendered = html.replace(pattern, (match, opening, tagName, closing) => {
    matches += 1;
    const configured = setTagAttribute(opening, "data-reputation-value", value);
    return `${configured}${escapeHtmlText(value)}${closing}`;
  });
  return { html: rendered, matches };
}

export function renderReputation(html, page, reputation, textByLanguage) {
  const text = textByLanguage?.[page.language];
  if (!text) return html;
  let rendered = html;

  for (const [key, value] of Object.entries(text)) {
    rendered = replaceReputationText(rendered, key, value).html;
  }
  rendered = rendered.replace(/<a\b[^>]*\bdata-reputation-link=["'][^"']+["'][^>]*>/gi, (tag) => {
    const key = parseAttributes(tag)["data-reputation-link"];
    const profileUrl = reputation?.[key]?.profileUrl;
    return profileUrl
      ? setTagAttribute(tag, "data-reputation-profile-url", profileUrl)
      : tag;
  });
  return rendered;
}

export function renderDiscordIdentity(html, discord) {
  const displayName = discord.displayName || discord.username.toUpperCase();
  let rendered = html.replace(
    /https:\/\/discord\.com\/users\/\d{15,22}/g,
    discord.profileUrl,
  );

  const protectedValues = [];
  rendered = rendered.replace(
    /\b(?:src|srcset|data-reputation-profile-url)\s*=\s*(["'])([\s\S]*?)\1/gi,
    (match) => {
      const token = `__RSPS_PROTECTED_ASSET_${protectedValues.length}__`;
      protectedValues.push(match);
      return token;
    },
  );

  const aliases = new Set([
    discord.username,
    displayName,
    ...(discord.aliases || []),
    ...(discord.templateUsernames || []),
  ].filter(Boolean));
  for (const alias of [...aliases].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    rendered = rendered.replace(pattern, (match) =>
      match === match.toUpperCase() ? displayName : discord.username,
    );
  }
  rendered = rendered.replace(/\b\d{17,20}\b/g, (match) =>
    match === discord.userId ||
      (discord.previousUserIds || []).includes(match) ||
      (discord.templateUserIds || []).includes(match)
      ? discord.userId
      : match,
  );

  return rendered.replace(/__RSPS_PROTECTED_ASSET_(\d+)__/g, (match, index) =>
    protectedValues[Number(index)] ?? match,
  );
}

// Home aliases remain accessible, but navigation must support the canonical
// directory routes. Never rewrite strings inside scripts, styles or comments.
export function renderCanonicalHomeLinks(html, canonical) {
  const base = new URL(canonical);
  let rendered = html;
  for (const token of scanHtmlTags(html).reverse()) {
    if (token.closing || token.name !== "a") continue;
    const href = token.attributes.href;
    if (!href || /^[#?]/.test(href) || "download" in token.attributes) continue;
    let target;
    try { target = new URL(href, base); } catch { continue; }
    if (target.origin !== base.origin || target.username || target.password) continue;
    const pathname = target.pathname === "/index.html" ? "/"
      : target.pathname === "/es/index.html" ? "/es/" : null;
    if (!pathname) continue;
    const suffix = href.match(/[?#][\s\S]*$/)?.[0] || "";
    const tag = token.raw.replace(
      /(\shref\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
      () => ` href="${escapeAttribute(pathname + suffix)}"`,
    );
    rendered = rendered.slice(0, token.startOffset) + tag + rendered.slice(token.endOffset);
  }
  return rendered;
}

export function renderCanonicalAndLanguages(html, page, context) {
  const canonical = context.canonicalUrl(page);
  const sourceCanonical = html.match(
    /<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/i,
  )?.[0];
  const previousCanonical = sourceCanonical
    ? parseAttributes(sourceCanonical).href || canonical
    : canonical;

  let rendered = html.replace(
    /<link\b(?=[^>]*\brel\s*=\s*["']alternate["'])(?=[^>]*\bhreflang\s*=)[^>]*>\s*/gi,
    "",
  );

  const canonicalPattern = /<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/i;
  if (!canonicalPattern.test(rendered) && page.indexable) {
    throw new Error(`${page.source}: missing canonical link in source template`);
  }

  if (page.indexable) {
    const alternates = context.translationsFor(page);
    const alternateLinks = alternates.length > 1
      ? [
          ...alternates.map(
            (alternate) =>
              `    <link rel="alternate" hreflang="${alternate.language}" href="${context.canonicalUrl(alternate)}" />`,
          ),
          `    <link rel="alternate" hreflang="x-default" href="${context.canonicalUrl(context.defaultTranslationFor(page))}" />`,
        ].join("\n")
      : "";
    rendered = rendered.replace(canonicalPattern, (tag) => {
      const updated = setTagAttribute(tag, "href", canonical);
      return alternateLinks ? `${updated}\n${alternateLinks}` : updated;
    });
  }

  rendered = rendered.replace(
    /<meta\b(?=[^>]*(?:property|name)\s*=\s*["']og:url["'])[^>]*>/gi,
    (tag) => setTagAttribute(tag, "content", canonical),
  );

  const translations = page.translationKey
    ? new Map(context.translationsFor(page).map((record) => [record.language, record]))
    : new Map();
  rendered = rendered.replace(/<a\b[^>]*>/gi, (tag) => {
    const attrs = parseAttributes(tag);
    // Only authored language controls opt into route rewriting. `hreflang` is
    // valid on ordinary links and must not make them translation controls.
    const language = attrs["data-language-code"];
    if (!language || !translations.has(language)) return tag;
    return setTagAttribute(tag, "href", context.publicPath(translations.get(language)));
  });

  const previousOrigin = new URL(previousCanonical).origin;
  const canonicalOrigin = new URL(canonical).origin;
  if (previousOrigin !== canonicalOrigin) {
    rendered = rendered.split(previousOrigin).join(canonicalOrigin);
  }

  rendered = renderCanonicalHomeLinks(rendered, canonical);
  return { html: rendered, canonical, previousCanonical };
}

function replaceElementContentById(html, tagName, id, value) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(<${tagName}\\b(?=[^>]*\\bid=["']${escapedId}["'])[^>]*>)[\\s\\S]*?(<\\/${tagName}>)`,
    "i",
  );
  return html.replace(pattern, `$1${value}$2`);
}

function replaceElementContentByClass(html, tagName, className, value, occurrence = 0) {
  const escapedClass = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(<${tagName}\\b(?=[^>]*\\bclass=["'][^"']*\\b${escapedClass}\\b[^"']*["'])[^>]*>)[\\s\\S]*?(<\\/${tagName}>)`,
    "gi",
  );
  let index = 0;
  return html.replace(pattern, (match, opening, closing) => {
    if (index++ !== occurrence) return match;
    return `${opening}${value}${closing}`;
  });
}

function replaceFaqItem(html, question, answer, matcher) {
  return html.replace(
    /<details\b([^>]*)>\s*<summary\b([^>]*)>([\s\S]*?)<\/summary>\s*<p\b([^>]*)>([\s\S]*?)<\/p>\s*<\/details>/gi,
    (match, detailsAttributes, summaryAttributes, currentQuestion, paragraphAttributes) => {
      if (!matcher(currentQuestion)) return match;
      const renderedQuestion = question ?? currentQuestion;
      return `<details${detailsAttributes}><summary${summaryAttributes}>${renderedQuestion}</summary><p${paragraphAttributes}>${answer}</p></details>`;
    },
  );
}

export function renderPaymentPolicy(html, page, paymentPolicy, helpers = {}) {
  const localized = paymentPolicy.fragments[page.language];
  if (!localized) return html;
  let rendered = html;

  // Authored payment summaries reuse the same policy as the homepage.
  rendered = rendered.replace(/(<p\b[^>]*data-payment-copy="(homepage|faq)\.([a-zA-Z]+)"[^>]*>)[\s\S]*?(<\/p>)/g,
    (match, opening, group, key, closing) => {
      const value = localized[group]?.[key];
      if (typeof value !== "string") throw new Error(`Unknown payment copy: ${group}.${key}`);
      return opening + escapeHtmlText(value) + closing;
    });

  if (page.family === "home") {
    const policy = localized.homepage;
    rendered = replaceElementContentByClass(rendered, "p", "payment-options__eyebrow", policy.eyebrow);
    rendered = replaceElementContentById(rendered, "h2", "payment-options-title", policy.heading);
    rendered = replaceElementContentByClass(rendered, "p", "payment-options__intro", policy.intro);
    rendered = replaceElementContentByClass(rendered, "p", "payment-option__category", policy.marketplaceCategory, 0);
    rendered = replaceElementContentById(rendered, "h3", "payment-option-eldorado-title", policy.marketplaceHeading);
    rendered = replaceElementContentByClass(rendered, "p", "payment-option__summary", policy.marketplaceSummary, 0);
    rendered = replaceElementContentByClass(rendered, "p", "payment-option__supporting", policy.marketplaceSupporting);
    if (policy.marketplaceAvailability) {
      rendered = replaceElementContentByClass(rendered, "p", "payment-option__checkout-note", policy.marketplaceAvailability);
    }
    rendered = replaceElementContentByClass(rendered, "p", "payment-option__availability", policy.marketplaceProcessor);
    rendered = replaceElementContentByClass(rendered, "p", "payment-option__category", policy.directCategory, 1);
    rendered = replaceElementContentById(rendered, "h3", "payment-option-direct-title", policy.directHeading);
    rendered = replaceElementContentByClass(rendered, "p", "payment-option__summary", policy.directSummary, 1);
    rendered = rendered.replace(
      /(<p\b[^>]*class=["'][^"']*\bdirect-trade-section__security\b[^"']*["'][^>]*>[\s\S]*?<span>)[\s\S]*?(<\/span>)/i,
      `$1${policy.cryptoSafety}$2`,
    );
    rendered = replaceElementContentByClass(
      rendered,
      "p",
      "direct-trade-section__text",
      policy.runescapeGoldAvailability,
    );
    rendered = replaceElementContentByClass(
      rendered,
      "p",
      "direct-trade-section__clarification",
      policy.runescapeGoldClarification,
    );
    rendered = replaceElementContentById(
      rendered,
      "h3",
      "payment-options-notice-title",
      policy.prePaymentHeading,
    );
    rendered = rendered.replace(
      /(<aside\b[^>]*class=["'][^"']*\bpayment-options__notice\b[^"']*["'][^>]*>[\s\S]*?<div>[\s\S]*?<\/h3>\s*<p\b[^>]*>)[\s\S]*?(<\/p>)/i,
      `$1${policy.prePaymentNotice}$2`,
    );

    if (localized.faq) {
      const faq = localized.faq;
      const entries = [
        [faq.marketplaceQuestion, faq.marketplaceAnswer, /Apple Pay|Visa|Mastercard/i],
        [faq.directQuestion, faq.directAnswer, /cryptocurrency|RuneScape gold/i],
        [faq.processorQuestion, faq.processorAnswer, /process payments/i],
        [faq.confirmationQuestion, faq.confirmationAnswer, /confirm before payment/i],
        [faq.websitePurchaseQuestion, faq.websitePurchaseAnswer, /comprar directamente/i],
        [faq.deliveryQuestion, faq.deliveryAnswer, /c[oó]mo se entrega/i],
        [faq.availabilityQuestion, faq.availabilityAnswer, /disponibilidad en todo momento/i],
      ];
      for (const [question, answer, matcher] of entries) {
        if (!question || !answer) continue;
        rendered = replaceFaqItem(rendered, question, answer, (current) => matcher.test(current));
      }
    }
  }

  if (
    page.language === "en" &&
    page.family.startsWith("commercial-") &&
    page.server &&
    localized.commercialFaq
  ) {
    const question = helpers.formatCommercialPaymentFaqQuestion?.(page.server);
    const answer = helpers.formatCommercialPaymentFaqAnswer?.(page.server);
    if (question && answer) {
      rendered = replaceFaqItem(
        rendered,
        question,
        answer,
        (current) => /payment methods/i.test(current),
      );
    }
  }
  return rendered;
}

export function renderSupportedServersFaq(html, page, answer) {
  if (page.family !== "home" || !answer) return html;
  const matcher = page.language === "es"
    ? /servidores RSPS son compatibles/i
    : /RSPS servers are supported/i;
  return replaceFaqItem(html, null, answer, (current) => matcher.test(current));
}

function applyRateToText(value, server, formatUsdAmount, language = "en") {
  if (!server.publishedRate || !server.currency.units) return value;
  value = value.replace(/(<strong\b[^>]*\bdata-rate-amount(?:="[^"]*")?[^>]*>)[\s\S]*?(<\/strong>)/g,
    (_, opening, closing) => opening + "$" + formatUsdAmount(server.publishedRate.usd, { fractionDigits: server.publishedRate.fractionDigits }) + closing);
  const currentUnits = server.currency.units;
  const templateUnits = server.currency.templateUnits || currentUnits;
  const unitStyles = ["short", "long"].filter(
    (style) => currentUnits[style] || templateUnits[style],
  );
  const unitValues = [...new Set(
    unitStyles.flatMap((style) => [currentUnits[style], templateUnits[style]]).filter(Boolean),
  )].sort((left, right) => right.length - left.length);
  const unitPattern = unitValues
    .map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const pattern = new RegExp(
    `\\$(\\d+(?:\\.(\\d+))?)(<\\/strong>)?(\\s+)(per|por)(\\s+)(${unitPattern})(\\s+PKP)?`,
    "gi",
  );

  return value.replace(
    pattern,
    (match, amount, decimalPart, closingStrong, beforeConnector, connector, beforeUnit, unit, suffix) => {
      const unitStyle = unitStyles.find((style) =>
        [currentUnits[style], templateUnits[style]]
          .filter(Boolean)
          .some((candidate) => candidate.toLowerCase() === unit.toLowerCase()),
      );
      if (!unitStyle) return match;
      const compact = (decimalPart?.length ?? 0) < server.publishedRate.fractionDigits;
      const formattedAmount = formatUsdAmount(server.publishedRate.usd, {
        fractionDigits: server.publishedRate.fractionDigits,
        compact,
      });
      const localizedConnector = language === "es" ? "por" : "per";
      return `$${formattedAmount}${closingStrong || ""}${beforeConnector}${localizedConnector}${beforeUnit}${currentUnits[unitStyle]}${suffix || ""}`;
    },
  );
}

export function renderPublishedRates(html, page, servers, formatUsdAmount, serverPages = {}) {
  if (page.family === "home") {
    return html.replace(
      /<article\b[^>]*class=["'][^"']*\bserver-card\b[^"']*["'][^>]*>[\s\S]*?<\/article>/gi,
      (card) => {
        const server = Object.values(servers).find(({ id }) => {
          const serverPage = serverPages[id];
          return serverPage && new RegExp(
            `href=["'][^"']*${serverPage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[#?][^"']*)?["']`,
            "i",
          ).test(card);
        });
        return server ? applyRateToText(card, server, formatUsdAmount, page.language) : card;
      },
    );
  }
  if (!page.family.startsWith("commercial-") || !page.server || !servers[page.server]) {
    return html;
  }
  return applyRateToText(html, servers[page.server], formatUsdAmount, page.language);
}

function updateHasPart(webPage, faqId) {
  const faqReference = { "@id": faqId };
  if (!webPage.hasPart) {
    webPage.hasPart = faqReference;
    return;
  }
  const parts = Array.isArray(webPage.hasPart) ? webPage.hasPart : [webPage.hasPart];
  const retained = parts.filter((part) => part?.["@id"] !== faqId && !String(part?.["@id"] || "").endsWith("#faq"));
  webPage.hasPart = [...retained, faqReference];
}

export function synchronizeJsonLd(html, page, { canonical, previousCanonical, discord }) {
  const scripts = parseJsonLdScripts(html, page.source);
  if (scripts.some((script) => script.error)) {
    const problem = scripts.find((script) => script.error);
    throw new Error(`${page.source}: invalid JSON-LD (${problem.error.message})`);
  }

  const visibleFaqs = page.faqPage ? extractVisibleFaqs(html, page.source) : [];
  const replacements = [];

  for (const script of scripts) {
    const value = structuredClone(script.value);
    replaceStrings(value, (text) => {
      if (text === previousCanonical) return canonical;
      if (text.startsWith(`${previousCanonical}#`)) return `${canonical}${text.slice(previousCanonical.length)}`;
      if (/^https:\/\/discord\.com\/users\/\d{15,22}$/.test(text)) return discord.profileUrl;
      return text;
    });

    const nodes = flattenNodes(value);
    const faqNodes = nodes.filter((node) => typeIncludes(node, "FAQPage"));
    if (page.faqPage) {
      if (faqNodes.length !== 1) {
        throw new Error(`${page.source}: expected one existing FAQPage node, found ${faqNodes.length}`);
      }
      const faqId = `${canonical}#faq`;
      faqNodes[0]["@id"] = faqId;
      faqNodes[0].mainEntity = visibleFaqs.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      }));
      const webPage = nodes.find((node) => typeIncludes(node, "WebPage"));
      if (!webPage) throw new Error(`${page.source}: FAQPage has no WebPage companion`);
      updateHasPart(webPage, faqId);
    } else if (faqNodes.length) {
      throw new Error(`${page.source}: unexpected FAQPage outside the preserved 19-page scope`);
    }

    replacements.push({
      start: script.contentLocation.start.offset,
      end: script.contentLocation.end.offset,
      value: `\n${JSON.stringify(value, null, 2)}\n    `,
    });
  }

  let rendered = html;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    rendered = rendered.slice(0, replacement.start) + replacement.value + rendered.slice(replacement.end);
  }
  return { html: rendered, faqCount: visibleFaqs.length };
}

export function rewriteGlobalStylesheet(html, href) {
  let replaced = false;
  const rendered = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const attrs = parseAttributes(tag);
    if (!/(?:^|\/)styles\.css(?:\?|$)/i.test(attrs.href || "")) return tag;
    replaced = true;
    return setTagAttribute(tag, "href", href);
  });
  if (!replaced) throw new Error("Page is missing the global styles.css link");
  return rendered;
}

export function rewriteGlobalScript(html, src) {
  let replaced = false;
  const rendered = html.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*><\/script>/gi, (tag) => {
    const attrs = parseAttributes(tag.slice(0, tag.indexOf(">") + 1));
    if (!/(?:^|\/)script\.js(?:\?|$)/i.test(attrs.src || "")) return tag;
    replaced = true;
    return setTagAttribute(tag, "src", src);
  });
  return { html: rendered, replaced };
}

export function rewriteOptimizedImageSources(html, replacements) {
  let rendered = html;
  for (const [original, definition] of Object.entries(replacements)) {
    const optimized = typeof definition === "string" ? definition : definition.path;
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rendered = rendered.replace(new RegExp(escaped, "g"), optimized);
  }
  return rendered.replace(/<img\b[^>]*>/gi, (tag) => {
    const attrs = parseAttributes(tag);
    const definition = Object.values(replacements).find((candidate) => {
      const optimized = typeof candidate === "string" ? candidate : candidate.path;
      return attrs.src?.endsWith(optimized);
    });
    if (!definition || typeof definition === "string") return tag;
    let rewritten = setTagAttribute(
      setTagAttribute(tag, "width", definition.width),
      "height",
      definition.height,
    );
    if (definition.variants?.length) {
      const prefix = String(attrs.src).slice(0, -definition.path.length);
      const candidates = [
        ...definition.variants,
        { path: definition.path, width: definition.width },
      ].sort((left, right) => left.width - right.width);
      const srcset = candidates
        .map(({ path: imagePath, width }) => `${prefix}${imagePath} ${width}w`)
        .join(", ");
      rewritten = setTagAttribute(rewritten, "srcset", srcset);
      rewritten = setTagAttribute(rewritten, "sizes", definition.sizes || "100vw");
    }
    return rewritten;
  });
}
