const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const SITE_ORIGIN = "https://rsps-gold.com";
export const SITE_NAME = "RSPS Gold Hub";
export const ACCEPTS_OTHER_SERVERS = true;

// Plausible now issues a site-specific script URL after a site is registered.
// Keep the integration dormant until that URL is supplied; an invented URL
// would look installed while silently collecting no measurements.
export const ANALYTICS = deepFreeze({
  domain: new URL(SITE_ORIGIN).hostname,
  scriptUrl: "",
});

export const UI_COPY = deepFreeze({
  en: { skipToContent: "Skip to content" },
  es: { skipToContent: "Saltar al contenido" },
});

export const REPUTATION = deepFreeze({
  eldorado: {
    profileUrl: "https://www.eldorado.gg/users/A6D9_Shop/reviews",
    positivePercent: "99.6%",
    reviewCount: "768+",
  },
  sythe: {
    profileUrl: "https://www.sythe.org/threads/a6d9-vouches/",
    vouchCount: "427+",
  },
});

export function formatReputationText(language = "en", reputation = REPUTATION) {
  if (language === "es") {
    return {
      "eldorado-positive-label": `${reputation.eldorado.positivePercent} positivas`,
      "eldorado-review-label": `${reputation.eldorado.reviewCount} Reseñas de Eldorado`,
      "sythe-vouch-label": `${reputation.sythe.vouchCount} referencias de Sythe`,
      "eldorado-positive-stat": `${reputation.eldorado.positivePercent} positivas`,
      "eldorado-review-stat": `${reputation.eldorado.reviewCount} reseñas`,
      "sythe-vouch-stat": `${reputation.sythe.vouchCount} referencias`,
      "eldorado-all-reviews-link": `Leer las ${reputation.eldorado.reviewCount} reseñas en Eldorado.gg →`,
      "sythe-all-vouches-link": `Ver ${reputation.sythe.vouchCount} referencias comerciales en Sythe.org →`,
    };
  }
  return {
    "eldorado-positive-label": `${reputation.eldorado.positivePercent} positive`,
    "eldorado-review-label": `${reputation.eldorado.reviewCount} Eldorado reviews`,
    "sythe-vouch-label": `${reputation.sythe.vouchCount} Sythe vouches`,
    "eldorado-positive-stat": `${reputation.eldorado.positivePercent} Positive`,
    "eldorado-review-stat": `${reputation.eldorado.reviewCount} Reviews`,
    "sythe-vouch-stat": `${reputation.sythe.vouchCount} Vouches`,
    "eldorado-all-reviews-link": `Read all ${reputation.eldorado.reviewCount} reviews on Eldorado.gg →`,
    "sythe-all-vouches-link": `View ${reputation.sythe.vouchCount} trade vouches on Sythe.org →`,
  };
}

export function formatPaymentProcessorQuestion(origin = SITE_ORIGIN) {
  return `Does ${new URL(origin).hostname} process payments?`;
}

const CURRENT_DISCORD_USERNAME = "a6d9";
const CURRENT_DISCORD_USER_ID = "640265737050652672";

export const DISCORD = deepFreeze({
  username: CURRENT_DISCORD_USERNAME,
  userId: CURRENT_DISCORD_USER_ID,
  profileUrl: `https://discord.com/users/${CURRENT_DISCORD_USER_ID}`,
  templateUsernames: ["a6d9"],
  templateUserIds: ["640265737050652672"],
});

export const SERVER_ORDER = deepFreeze([
  "impact",
  "roatPkz",
  "spawnPk",
  "alora",
  "runex",
  "orion",
  "ferox",
  "nearReality",
  "other",
]);

export const SERVERS = deepFreeze({
  impact: {
    id: "impact",
    canonicalName: "Impact",
    aliases: ["Impact RSPS"],
    capability: "listed",
    currency: {
      canonicalName: "Impact gold",
      aliases: ["gold"],
      units: { short: "1B", long: "Bill" },
      templateUnits: { short: "1B", long: "Bill" },
    },
    publishedRate: { qualifier: "from", usd: 1, fractionDigits: 0 },
  },
  roatPkz: {
    id: "roatPkz",
    canonicalName: "Roat PKZ",
    aliases: ["RoatPKZ", "Roat Pkz"],
    capability: "listed",
    currency: {
      canonicalName: "PKP",
      aliases: ["PK Points", "Roat PKZ gold"],
      units: { short: "1M", long: "Mill" },
      templateUnits: { short: "1M", long: "Mill" },
    },
    publishedRate: { qualifier: "from", usd: 3.5, fractionDigits: 2 },
  },
  spawnPk: {
    id: "spawnPk",
    canonicalName: "SpawnPK",
    aliases: ["Spawn PK", "Spawn Server"],
    capability: "listed",
    currency: {
      canonicalName: "SpawnPK gold",
      aliases: ["coins", "Cash Bags"],
      units: { short: "1T", long: "Trill" },
      templateUnits: { short: "1T", long: "Trill" },
      cashBagValueCoins: 100_000_000,
    },
    publishedRate: { qualifier: "from", usd: 9, fractionDigits: 0 },
  },
  alora: {
    id: "alora",
    canonicalName: "Alora",
    aliases: [],
    capability: "listed",
    currency: {
      canonicalName: "Alora gold",
      aliases: ["gold"],
      units: { short: "1B", long: "Bill" },
      templateUnits: { short: "1B", long: "Bill" },
    },
    publishedRate: { qualifier: "from", usd: 35, fractionDigits: 0 },
  },
  runex: {
    id: "runex",
    canonicalName: "RuneX",
    aliases: ["Runex"],
    capability: "listed",
    currency: {
      canonicalName: "RuneX gold",
      aliases: ["gold"],
      units: null,
    },
    publishedRate: null,
  },
  orion: {
    id: "orion",
    canonicalName: "Orion",
    aliases: ["Orion RSPS"],
    capability: "listed",
    currency: {
      canonicalName: "Orion gold",
      aliases: ["gold"],
      units: { short: "1B", long: "Bill" },
      templateUnits: { short: "1B", long: "Bill" },
    },
    publishedRate: { qualifier: "from", usd: 25, fractionDigits: 0 },
  },
  ferox: {
    id: "ferox",
    canonicalName: "Ferox",
    aliases: ["Ferox PS"],
    capability: "listed",
    currency: {
      canonicalName: "Ferox gold",
      aliases: ["gold"],
      units: { short: "1B", long: "Bill" },
      templateUnits: { short: "1B", long: "Bill" },
    },
    publishedRate: { qualifier: "from", usd: 20, fractionDigits: 0 },
  },
  nearReality: {
    id: "nearReality",
    canonicalName: "Near-Reality",
    aliases: ["Near Reality"],
    capability: "listed",
    currency: {
      canonicalName: "NRGP",
      aliases: ["Near-Reality gold", "Near-Reality coins"],
      units: null,
    },
    publishedRate: null,
  },
  other: {
    id: "other",
    canonicalName: "Other RSPS",
    aliases: ["Other RSPS servers", "Otros RSPS", "unlisted server"],
    capability: "case-by-case",
    currency: {
      canonicalName: null,
      aliases: [],
      units: null,
    },
    publishedRate: null,
  },
});

export const PAYMENT_POLICY = deepFreeze({
  fragments: {
    en: {
      homepage: {
        eyebrow: "Flexible ways to pay",
        heading: "Choose the payment option that works for you",
        intro:
          "Once your order details are confirmed, choose between Eldorado.gg checkout, supported cryptocurrency, or an eligible OSRS or RS3 gold exchange.",
        marketplaceCategory: "Eldorado.gg checkout",
        marketplaceHeading: "Pay by card or digital wallet through Eldorado.gg",
        marketplaceSummary:
          "Prefer a familiar checkout? Once we confirm the server, amount, price, stock and delivery details, you can complete the agreed order through Eldorado.gg.",
        marketplaceSupporting:
          "Available options may include Apple Pay, Visa, Mastercard, credit cards, debit cards and other regional payment methods.",
        marketplaceAvailability: "Payment options vary by location and are shown during checkout.",
        marketplaceProcessor:
          "Payments are processed by Eldorado.gg. Review the final amount and payment method before completing checkout.",
        directCategory: "Direct payment",
        directHeading: "Pay with crypto or RuneScape gold",
        directSummary:
          "For eligible direct trades, you can pay with supported cryptocurrency or exchange OSRS or RS3 gold at the agreed rate.",
        cryptoSafety: "Confirm the currency, network and wallet address with us before sending funds.",
        runescapeGoldAvailability:
          "Some orders can be completed using OSRS or RS3 gold. Eligibility and the exchange rate depend on the server, amount, stock and current market conditions.",
        runescapeGoldClarification: "RuneScape gold exchange is not available for every order.",
        prePaymentHeading: "Confirm your order before paying",
        prePaymentNotice:
          "Message us first to confirm the server, amount, price, stock, payment method and delivery plan. Do not place an Eldorado.gg order or send funds until every detail has been agreed.",
      },
      faq: {
        marketplaceQuestion: "Can I pay with Apple Pay, Visa or Mastercard?",
        marketplaceAnswer:
          "Depending on your location and checkout eligibility, Eldorado.gg checkout may include Apple Pay, Visa, Mastercard, credit cards and debit cards. The final payment methods are shown by Eldorado.gg during checkout.",
        directQuestion: "Can I pay with cryptocurrency or RuneScape gold?",
        directAnswer:
          "Eligible direct trades may support Bitcoin, Ethereum, Litecoin or Tether. Some orders may also be completed through an agreed OSRS or RS3 gold exchange, depending on the server, amount, stock and current exchange rate.",
        processorQuestion: formatPaymentProcessorQuestion(),
        processorAnswer:
          "No. This website provides information and verified contact details for arranging a trade. Payment is completed only through the method agreed during the conversation, such as Eldorado.gg checkout or an eligible direct-payment option.",
        confirmationQuestion: "What should I confirm before payment?",
        confirmationAnswer:
          "Confirm the server, currency, quantity, unit rate, complete order total, available stock, payment method, delivery method and verified Discord user ID. Do not proceed while any detail remains unclear.",
      },
      commercialFaq: {
        featuredQuestions: {
          impact: "Which payment methods may be available for Impact gold?",
          roatPkz: "Which payment methods may be available for Roat Pkz PKP?",
          spawnPk: "Which payment methods may be available for SpawnPK gold?",
        },
        genericQuestion: "Which payment methods may be available?",
        featuredAnswer:
          "Payment is agreed after the order details are confirmed. Options may include Eldorado.gg checkout, supported cryptocurrency or an eligible OSRS or RS3 gold exchange, depending on the order and checkout availability.",
        namedOrderAnswerTemplate:
          "Payment options are confirmed after the {serverName} order details are agreed. They may include Eldorado.gg checkout, supported cryptocurrency or an eligible OSRS or RS3 gold exchange, depending on the order and checkout availability.",
        unlistedAnswer:
          "Payment is agreed after the unlisted-server order details are confirmed. Options may include Eldorado.gg checkout, supported cryptocurrency or an eligible OSRS or RS3 gold exchange, depending on the order and checkout availability.",
      },
    },
    es: {
      homepage: {
        eyebrow: "Opciones de pago flexibles",
        heading: "Métodos de pago para operaciones confirmadas",
        intro:
          "Los detalles de la operación se acuerdan antes del pago. Completa el pedido acordado a través de Eldorado.gg, paga directamente con criptomonedas o realiza un intercambio válido con oro de OSRS o RS3.",
        marketplaceCategory: "Pago mediante marketplace",
        marketplaceHeading: "Pagar a través de Eldorado.gg",
        marketplaceSummary:
          "Después de acordar el servidor, la cantidad, el precio, la disponibilidad y los detalles de entrega, podrás realizar el pedido confirmado a través de Eldorado.gg y utilizar los métodos de pago disponibles durante el proceso de compra.",
        marketplaceSupporting:
          "Los métodos disponibles pueden incluir tarjetas, carteras digitales, criptomonedas y opciones de pago regionales, según la ubicación y la disponibilidad durante el proceso de compra.",
        marketplaceProcessor:
          "Eldorado.gg muestra las opciones finales durante el proceso de compra y procesa los pagos realizados mediante su plataforma.",
        directCategory: "Operación directa",
        directHeading: "Criptomonedas u oro de RuneScape",
        directSummary:
          "Para una operación directa acordada, el pago puede realizarse con una criptomoneda compatible o, cuando esté disponible, con oro de OSRS o RS3.",
        cryptoSafety:
          "Confirma la criptomoneda, la red y la dirección de la billetera antes de enviar fondos.",
        runescapeGoldAvailability:
          "Algunas operaciones pueden completarse con oro de OSRS o RS3. La disponibilidad y la tasa de intercambio dependen del servidor, la cantidad, la tarifa actual, las existencias y el tipo de operación.",
        runescapeGoldClarification:
          "No todos los pedidos pueden realizarse mediante un intercambio con oro de RuneScape.",
        prePaymentHeading: "Antes del pago",
        prePaymentNotice:
          "Todos los detalles de la operación deben acordarse antes de realizar un pedido en Eldorado.gg, enviar criptomonedas o entregar oro de RuneScape. Utiliza las opciones de contacto disponibles en otras partes de la página para acordar la operación.",
      },
      faq: {
        websitePurchaseQuestion: "¿Puedo comprar directamente en el sitio web?",
        websitePurchaseAnswer:
          "No. El sitio web explica el proceso y ayuda a los usuarios a encontrar el contacto correcto de Discord. Toda la comunicación, la confirmación de tarifas, los detalles del pago y las instrucciones de entrega se gestionan por Discord.",
        deliveryQuestion: "¿Cómo se entrega el oro?",
        deliveryAnswer:
          "El método de transferencia disponible para ese servidor se acuerda en Discord antes del pago. La entrega sigue el servidor, la moneda, la cantidad y el plan confirmados.",
        availabilityQuestion: "¿Hay disponibilidad en todo momento?",
        availabilityAnswer:
          "La disponibilidad depende del servidor y del tamaño del pedido. Se confirma en Discord antes de finalizar los detalles del pago.",
      },
      commercialFaq: null,
    },
  },
});

export const site = deepFreeze({
  origin: SITE_ORIGIN,
  name: SITE_NAME,
  analytics: ANALYTICS,
  ui: UI_COPY,
  reputation: REPUTATION,
  discord: DISCORD,
  supportedServerOrder: SERVER_ORDER,
  acceptsOtherServers: ACCEPTS_OTHER_SERVERS,
  servers: SERVERS,
  paymentPolicy: PAYMENT_POLICY,
});

export function getServer(serverId) {
  const server = SERVERS[serverId];
  if (!server) throw new RangeError(`Unknown server id: ${serverId}`);
  return server;
}

export function formatUsdAmount(value, { fractionDigits = 0, compact = false } = {}) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("USD value must be a finite non-negative number");
  }
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 6) {
    throw new RangeError("fractionDigits must be an integer from 0 through 6");
  }
  const fixed = value.toFixed(fractionDigits);
  return compact && fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

export function formatPublishedRate(
  serverId,
  {
    locale = "en",
    unitStyle = "short",
    includeQualifier = true,
    qualifierCase = "title",
    compactAmount = false,
  } = {},
) {
  if (locale !== "en" && locale !== "es") throw new RangeError(`Unsupported locale: ${locale}`);
  if (unitStyle !== "short" && unitStyle !== "long") {
    throw new RangeError(`Unsupported unit style: ${unitStyle}`);
  }
  if (qualifierCase !== "title" && qualifierCase !== "lower") {
    throw new RangeError(`Unsupported qualifier case: ${qualifierCase}`);
  }

  const server = getServer(serverId);
  const rate = server.publishedRate;
  if (!rate) return null;
  const unit = server.currency.units?.[unitStyle] ?? server.currency.units?.short;
  if (!unit) throw new Error(`${serverId} has a published rate without a published unit`);

  const amount = `$${formatUsdAmount(rate.usd, {
    fractionDigits: rate.fractionDigits,
    compact: compactAmount,
  })}`;
  const connector = locale === "es" ? "por" : "per";
  if (!includeQualifier) return `${amount} ${connector} ${unit}`;

  const qualifier = locale === "es" ? "desde" : rate.qualifier;
  const displayedQualifier = qualifierCase === "title"
    ? qualifier[0].toUpperCase() + qualifier.slice(1)
    : qualifier;
  return `${displayedQualifier} ${amount} ${connector} ${unit}`;
}

export function formatCommercialPaymentFaqAnswer(serverId) {
  const server = getServer(serverId);
  const fragments = PAYMENT_POLICY.fragments.en.commercialFaq;
  if (fragments.featuredQuestions[serverId]) return fragments.featuredAnswer;
  if (serverId === "other") return fragments.unlistedAnswer;
  return fragments.namedOrderAnswerTemplate.replace("{serverName}", server.canonicalName);
}

export function formatCommercialPaymentFaqQuestion(serverId) {
  getServer(serverId);
  const fragments = PAYMENT_POLICY.fragments.en.commercialFaq;
  return fragments.featuredQuestions[serverId] ?? fragments.genericQuestion;
}

function formatServerList(names, locale) {
  if (names.length < 2) return names[0] || "";
  const connector = locale === "es" ? " y " : " and ";
  return `${names.slice(0, -1).join(", ")}${connector}${names.at(-1)}`;
}

export function formatSupportedServersFaqAnswer(
  locale = "en",
  {
    serverOrder = SERVER_ORDER,
    servers = SERVERS,
    acceptsOtherServers = ACCEPTS_OTHER_SERVERS,
  } = {},
) {
  if (locale !== "en" && locale !== "es") {
    throw new RangeError(`Unsupported locale: ${locale}`);
  }
  const names = serverOrder
    .filter((serverId) => serverId !== "other")
    .map((serverId) => {
      const server = servers[serverId];
      if (!server) throw new RangeError(`Unknown server id: ${serverId}`);
      return server.canonicalName;
    });
  const list = formatServerList(names, locale);
  if (locale === "es") {
    const other = acceptsOtherServers
      ? " Los servidores no listados se revisan caso por caso."
      : "";
    return `Hay páginas específicas de solicitud de cotización para ${list}.${other}`;
  }
  const other = acceptsOtherServers
    ? " Other private servers may be considered case by case, depending on current stock and available transfer options."
    : "";
  return `Dedicated gold pages are available for ${list}.${other}`;
}
