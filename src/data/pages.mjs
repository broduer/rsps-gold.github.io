const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const PAGE_FAMILIES = deepFreeze({
  error: "error",
  home: "home",
  commercialFeatured: "commercial-featured",
  commercialStandard: "commercial-standard",
  guideIndex: "guide-index",
  guideHub: "guide-hub",
  guideArticle: "guide-article",
});

const LAST_MODIFIED_CURRENT = "2026-08-01";

const BASE_CSS = ["base"];
const CORE_JS = ["core"];
const COMMERCIAL_CSS = ["base", "commerce", "shared-discord-cta"];
const FEATURED_COMMERCIAL_CSS = [
  ...COMMERCIAL_CSS,
  "commercial-featured",
  "language-switcher",
];
const STANDARD_COMMERCIAL_CSS = [...COMMERCIAL_CSS, "commercial-standard"];
const GUIDE_CSS = [
  "base",
  "guides",
  "guide-header",
  "guide-faq",
  "related-guides",
  "shared-discord-cta",
];

function page(source, options) {
  const output = options.output ?? source;
  return deepFreeze({
    source,
    output,
    pathname: options.pathname ?? `/${output}`,
    language: options.language ?? "en",
    indexable: options.indexable ?? true,
    sitemap: options.sitemap ?? true,
    translationKey: options.translationKey ?? null,
    faqPage: options.faqPage ?? false,
    lastModified: options.lastModified ?? LAST_MODIFIED_CURRENT,
    family: options.family,
    server: options.server ?? null,
    features: {
      css: [...(options.css ?? BASE_CSS)],
      js: [...(options.js ?? CORE_JS)],
    },
  });
}

export const pages = deepFreeze([
  page("404.html", {
    pathname: "/404.html",
    indexable: false,
    sitemap: false,
    lastModified: "2026-07-30",
    family: PAGE_FAMILIES.error,
    css: ["base", "error-page"],
    js: [],
  }),
  page("index.html", {
    pathname: "/",
    translationKey: "home",
    family: PAGE_FAMILIES.home,
    css: [
      "base",
      "home",
      "language-switcher",
      "shared-discord-cta",
      "reputation",
      "discord-profile-card",
      "payment-options",
    ],
    js: ["core", "language-switcher", "home-reputation", "discord-profile-card"],
  }),
  page("impact-gold.html", {
    pathname: "/impact-gold.html",
    translationKey: "impact-gold",
    family: PAGE_FAMILIES.commercialFeatured,
    server: "impact",
    css: [...FEATURED_COMMERCIAL_CSS, "impact-gold"],
    js: ["core", "language-switcher"],
  }),
  page("roat-pkz-gold.html", {
    pathname: "/roat-pkz-gold.html",
    translationKey: "roat-pkz-gold",
    family: PAGE_FAMILIES.commercialFeatured,
    server: "roatPkz",
    css: [...FEATURED_COMMERCIAL_CSS, "roat-pkz-gold"],
    js: ["core", "language-switcher"],
  }),
  page("spawnpk-gold.html", {
    pathname: "/spawnpk-gold.html",
    lastModified: "2026-09-12",
    translationKey: "spawnpk-gold",
    family: PAGE_FAMILIES.commercialFeatured,
    server: "spawnPk",
    css: [...FEATURED_COMMERCIAL_CSS, "spawnpk-gold"],
    js: ["core", "language-switcher"],
  }),
  page("alora-gold.html", {
    pathname: "/alora-gold.html",
    family: PAGE_FAMILIES.commercialStandard,
    server: "alora",
    css: STANDARD_COMMERCIAL_CSS,
  }),
  page("runex-gold.html", {
    pathname: "/runex-gold.html",
    family: PAGE_FAMILIES.commercialStandard,
    server: "runex",
    css: STANDARD_COMMERCIAL_CSS,
  }),
  page("orion-gold.html", {
    pathname: "/orion-gold.html",
    family: PAGE_FAMILIES.commercialStandard,
    server: "orion",
    css: STANDARD_COMMERCIAL_CSS,
  }),
  page("ferox-gold.html", {
    pathname: "/ferox-gold.html",
    family: PAGE_FAMILIES.commercialStandard,
    server: "ferox",
    css: STANDARD_COMMERCIAL_CSS,
  }),
  page("near-reality-gold.html", {
    pathname: "/near-reality-gold.html",
    family: PAGE_FAMILIES.commercialStandard,
    server: "nearReality",
    css: STANDARD_COMMERCIAL_CSS,
  }),
  page("other-rsps-gold.html", {
    pathname: "/other-rsps-gold.html",
    family: PAGE_FAMILIES.commercialStandard,
    server: "other",
    css: STANDARD_COMMERCIAL_CSS,
  }),
  page("guides.html", {
    pathname: "/guides.html",
    family: PAGE_FAMILIES.guideIndex,
    faqPage: true,
    css: [...GUIDE_CSS, "guide-index"],
  }),
  page("impact-guide.html", {
    pathname: "/impact-guide.html",
    family: PAGE_FAMILIES.guideHub,
    server: "impact",
    faqPage: true,
    css: [...GUIDE_CSS, "server-guide-hub", "impact-guide-hub"],
  }),
  page("impact-chambers-of-xeric-guide.html", {
    pathname: "/impact-chambers-of-xeric-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "impact",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "impact-guides", "impact-cox"],
  }),
  page("impact-donator-benefits-guide.html", {
    pathname: "/impact-donator-benefits-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "impact",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "impact-guides", "impact-donator-ranks"],
    js: ["core", "impact-rank-calculator"],
  }),
  page("impact-gemstone-crab-guide.html", {
    pathname: "/impact-gemstone-crab-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "impact",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "impact-guides", "impact-gemstone-crab"],
  }),
  page("impact-hunter-guide.html", {
    pathname: "/impact-hunter-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "impact",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "impact-guides", "impact-hunter"],
    js: ["core", "impact-hunter-planner"],
  }),
  page("impact-money-making-guide.html", {
    pathname: "/impact-money-making-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "impact",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "impact-guides", "impact-money-making"],
    js: ["core", "impact-profit-calculator"],
  }),
  page("impact-slayer-guide.html", {
    pathname: "/impact-slayer-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "impact",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "impact-guides", "impact-slayer"],
    js: ["core", "impact-slayer-tier-helper", "impact-slayer-directory"],
  }),
  page("impact-theatre-of-blood-guide.html", {
    pathname: "/impact-theatre-of-blood-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "impact",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "impact-guides", "impact-theatre-of-blood"],
  }),
  page("impact-thieving-guide.html", {
    pathname: "/impact-thieving-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "impact",
    faqPage: true,
    css: [
      ...GUIDE_CSS,
      "guide-article",
      "impact-guides",
      "impact-hunter",
      "impact-thieving",
    ],
    js: ["core", "impact-thieving-planner"],
  }),
  page("impact-tombs-of-amascut-guide.html", {
    pathname: "/impact-tombs-of-amascut-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "impact",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "impact-guides", "impact-tombs-of-amascut"],
  }),
  page("roat-pkz-guide.html", {
    pathname: "/roat-pkz-guide.html",
    family: PAGE_FAMILIES.guideHub,
    server: "roatPkz",
    faqPage: true,
    css: [...GUIDE_CSS, "server-guide-hub", "roat-pkz-guide-hub"],
  }),
  page("roat-pkz-donator-ranks-guide.html", {
    pathname: "/roat-pkz-donator-ranks-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "roatPkz",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "roat-pkz-guides", "roat-pkz-donator-ranks"],
    js: ["core", "roat-pkz-rank-finder"],
  }),
  page("roat-pkz-money-making-guide.html", {
    pathname: "/roat-pkz-money-making-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "roatPkz",
    faqPage: true,
    css: [
      ...GUIDE_CSS,
      "guide-article",
      "roat-pkz-guides",
      "roat-pkz-money-making",
      "shared-money-calculator",
    ],
    js: ["core", "roat-pkz-method-finder", "roat-pkz-profit-calculator"],
  }),
  page("roat-pkz-starter-guide.html", {
    pathname: "/roat-pkz-starter-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "roatPkz",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "roat-pkz-guides", "roat-pkz-starter"],
    js: ["core", "roat-pkz-command-directory"],
  }),
  page("spawnpk-guide.html", {
    pathname: "/spawnpk-guide.html",
    family: PAGE_FAMILIES.guideHub,
    server: "spawnPk",
    faqPage: true,
    css: [...GUIDE_CSS, "server-guide-hub", "spawnpk-guide-hub"],
  }),
  page("spawnpk-donator-ranks-guide.html", {
    pathname: "/spawnpk-donator-ranks-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "spawnPk",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "spawnpk-guides", "spawnpk-donator-ranks"],
    js: ["core", "spawnpk-rank-calculator"],
  }),
  page("spawnpk-money-making-guide.html", {
    pathname: "/spawnpk-money-making-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "spawnPk",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "spawnpk-guides", "spawnpk-money-making"],
    js: ["core", "spawnpk-method-finder", "spawnpk-profit-calculator"],
  }),
  page("spawnpk-starter-guide.html", {
    pathname: "/spawnpk-starter-guide.html",
    family: PAGE_FAMILIES.guideArticle,
    server: "spawnPk",
    faqPage: true,
    css: [...GUIDE_CSS, "guide-article", "spawnpk-guides", "spawnpk-starter"],
    js: ["core", "spawnpk-starter-checklist"],
  }),
  page("es/index.html", {
    pathname: "/es/",
    language: "es",
    translationKey: "home",
    family: PAGE_FAMILIES.home,
    css: [
      "base",
      "home",
      "language-switcher",
      "shared-discord-cta",
      "reputation",
      "discord-profile-card",
      "payment-options",
    ],
    js: ["core", "language-switcher", "home-reputation", "discord-profile-card"],
  }),
  page("es/impact-gold.html", {
    pathname: "/es/impact-gold.html",
    language: "es",
    translationKey: "impact-gold",
    family: PAGE_FAMILIES.commercialFeatured,
    server: "impact",
    css: [...FEATURED_COMMERCIAL_CSS, "impact-gold"],
    js: ["core", "language-switcher"],
  }),
  page("es/roat-pkz-gold.html", {
    pathname: "/es/roat-pkz-gold.html",
    language: "es",
    translationKey: "roat-pkz-gold",
    family: PAGE_FAMILIES.commercialFeatured,
    server: "roatPkz",
    css: [...FEATURED_COMMERCIAL_CSS, "roat-pkz-gold"],
    js: ["core", "language-switcher"],
  }),
  page("es/spawnpk-gold.html", {
    pathname: "/es/spawnpk-gold.html",
    language: "es",
    translationKey: "spawnpk-gold",
    family: PAGE_FAMILIES.commercialFeatured,
    server: "spawnPk",
    css: [...FEATURED_COMMERCIAL_CSS, "spawnpk-gold"],
    js: ["core", "language-switcher"],
  }),
]);

const unique = (values) => new Set(values).size === values.length;

if (pages.length !== 34) throw new Error(`Expected 34 HTML pages, found ${pages.length}`);
if (!unique(pages.map(({ source }) => source))) throw new Error("Duplicate page source");
if (!unique(pages.map(({ output }) => output))) throw new Error("Duplicate page output");
if (!unique(pages.map(({ pathname }) => pathname))) throw new Error("Duplicate public pathname");
if (pages.filter(({ faqPage }) => faqPage).length !== 19) {
  throw new Error("Existing FAQPage scope must contain exactly 19 pages");
}
if (pages.filter(({ sitemap }) => sitemap).length !== 33) {
  throw new Error("Sitemap scope must contain exactly 33 pages");
}

export const pageByOutput = deepFreeze(
  Object.fromEntries(pages.map((entry) => [entry.output, entry])),
);

export const translationClusters = deepFreeze(
  Object.fromEntries(
    [...new Set(pages.map(({ translationKey }) => translationKey).filter(Boolean))]
      .sort()
      .map((translationKey) => [
        translationKey,
        Object.fromEntries(
          pages
            .filter((entry) => entry.translationKey === translationKey)
            .map((entry) => [entry.language, entry]),
        ),
      ]),
  ),
);

if (Object.keys(translationClusters).length !== 4) {
  throw new Error("Expected exactly four English/Spanish translation clusters");
}
for (const [translationKey, cluster] of Object.entries(translationClusters)) {
  if (!cluster.en || !cluster.es || Object.keys(cluster).length !== 2) {
    throw new Error(`Translation cluster ${translationKey} must contain exactly en and es`);
  }
}

export const faqSchemaPages = deepFreeze(
  pages.filter(({ faqPage }) => faqPage).map(({ output }) => output),
);

export const cssFeatureKeys = deepFreeze(
  [...new Set(pages.flatMap(({ features }) => features.css))].sort(),
);

export const jsFeatureKeys = deepFreeze(
  [...new Set(pages.flatMap(({ features }) => features.js))].sort(),
);

export function getPageByOutput(output) {
  const entry = pageByOutput[output];
  if (!entry) throw new RangeError(`Unknown page output: ${output}`);
  return entry;
}
