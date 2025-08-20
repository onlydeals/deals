// ===== ONLYDEALS eBay loader (no API) =====
// Version: 20

/* ---------- CONFIG ---------- */
const CAMPID = "5339119674"; // your ePN campaign id
// Your server-side proxy that fetches eBay HTML (Vercel/Cloudflare/etc.)
const PROXY_BASE = "https://onlydeals-proxy.vercel.app/api/rss";

/* ---------- helpers ---------- */

function toAbs(url, base = "https://www.ebay.com") {
  if (!url) return "";
  try { return new URL(url, base).toString(); } catch { return url; }
}

function fixImg(url) {
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  return toAbs(url);
}

// Keep full querystring when path already looks like an item/product URL
function normalizeEbayItemUrl(input) {
  const abs = toAbs(input);
  if (!abs) return "";
  let u;
  try { u = new URL(abs); } catch { return abs; }

  if (/\bebay\./i.test(u.hostname)) {
    // 1) Direct item/product paths → KEEP existing query; strip only hash
    if (/\/itm\//i.test(u.pathname) || /^\/p\//i.test(u.pathname)) {
      u.hash = "";
      return u.toString();
    }

    // 2) Redirect-style params (loc, dlredirect, u, l, ru)
    const loc = u.searchParams.get("loc") || u.searchParams.get("dlredirect");
    if (loc) {
      const deep = normalizeEbayItemUrl(loc);
      if (deep) return deep;
    }
    const alt = u.searchParams.get("u") || u.searchParams.get("l") || u.searchParams.get("ru");
    if (alt) {
      const deep = normalizeEbayItemUrl(alt);
      if (deep) return deep;
    }

    // 3) Path contains item id → build minimal if needed
    const m = u.pathname.match(/\/itm\/(\d+)/i);
    if (m) return `https://www.ebay.com/itm/${m[1]}`;
  }
  return abs;
}

// Simple plausibility check for item URLs
function looksLikeValidItemUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (!/\bebay\./i.test(u.hostname)) return false;
    const m = u.pathname.match(/\/itm\/(\d+)/i) || u.pathname.match(/^\/p\/(\d+)/i);
    if (!m) return false;
    const id = m[1];
    return id && id.length >= 9 && id.length <= 14;
  } catch { return false; }
}

// Build *direct* eBay link with official tracking params (no rover redirect)
function affiliateLink(itemUrl, customid = "") {
  const u = new URL(itemUrl, "https://www.ebay.com"); // preserves existing query
  u.searchParams.set("mkcid", "1");
  u.searchParams.set("mkrid", "711-53200-19255-0");
  u.searchParams.set("siteid", "0");
  u.searchParams.set("campid", CAMPID);
  if (customid) u.searchParams.set("customid", customid);
  u.searchParams.set("toolid", "10001");
  u.hash = ""; // drop fragments
  return u.toString();
}

// eBay search URL
function ebaySearchUrl(q) {
  const u = new URL("https://www.ebay.com/sch/i.html");
  u.searchParams.set("_nkw", q);
  u.searchParams.set("LH_BIN", "1"); // Buy It Now
  u.searchParams.set("_sop", "12");  // Newly listed
  u.searchParams.set("_ipg", "60");  // more items
  return u.toString();
}

// Fetch HTML via proxy (to avoid CORS)
async function fetchSearchHtml(q) {
  const target = ebaySearchUrl(q);
  const proxied = `${PROXY_BASE}?url=${encodeURIComponent(target)}`;
  const r = await fetch(proxied, { mode: "cors", cache: "no-store" });
  if (!r.ok) throw new Error("proxy status " + r.status);
  return await r.text();
}

function uniqueByLink(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (toAbs(it.link) || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/* ---------- parser ---------- */

function parseSearchHtml(html, maxPool = 200) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const pool = [];

  // 1) JSON-LD (schema.org SearchResultsPage)
  const ldScripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of ldScripts) {
    try {
      const json = JSON.parse(s.textContent || "null");
      const list = json && (json.itemListElement || (Array.isArray(json) && json.find(x => x.itemListElement)?.itemListElement));
      if (Array.isArray(list) && list.length) {
        for (let idx = 0; idx < list.length && pool.length < maxPool; idx++) {
          const el = list[idx];
          const it = el.item || el;
          const title = (it?.name || "").trim();
          const link  = normalizeEbayItemUrl(it?.url || "");
          const img   = fixImg((Array.isArray(it?.image) ? it.image[0] : it?.image) || "");
          const offer = it?.offers || {};
          const price = ((offer.priceCurrency ? offer.priceCurrency + " " : "") + (offer.price || "")).trim();
          if (link) pool.push({ title, link, img, price, was: "", customid: "ldjson_"+idx });
        }
      }
    } catch { /* ignore */ }
  }

  // 2) DOM fallbacks
  const containers = [
    doc.querySelector(".srp-results"),
    doc.querySelector("#srp-river-results"),
    doc.querySelector('[data-search-results]')
  ].filter(Boolean);

  for (const container of containers) {
    let cards = Array.from(container.querySelectorAll("li.s-item"));
    if (!cards.length) cards = Array.from(container.querySelectorAll("[data-view*='mi:'], [data-view*='iid:']"));

    // skip ads
    cards = cards.filter(li => !/Sponsored|AdChoice/i.test(li.textContent || ""));

    for (let idx = 0; idx < cards.length && pool.length < maxPool; idx++) {
      const li = cards[idx];
      const a       = li.querySelector("a.s-item__link") || li.querySelector("a[href*='/itm/']");
      const imgEl   = li.querySelector("img.s-item__image-img") || li.querySelector("img");
      const titleEl = li.querySelector(".s-item__title") || li.querySelector("[role='heading']");
      const priceEl = li.querySelector(".s-item__price") || li.querySelector("[data-testid='x-price']");
      const origEl  = li.querySelector(".s-item__original-price, .s-item__trending-price, .s-item__was-price, .STRIKETHROUGH");

      const rawLink = a?.getAttribute("href") || a?.href || "";
      const link    = normalizeEbayItemUrl(rawLink);
      const img     = fixImg(imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || "");
      const title   = (titleEl?.textContent || "").replace(/^\s*New Listing\s*/i, "").trim() || "eBay item";
      const price   = (priceEl?.textContent || "").trim();
      const was     = (origEl?.textContent || "").trim();

      if (link) pool.push({ title, link, img, price, was, customid: "html_"+idx });
    }
  }

  // dedupe, keep plausible items
  return uniqueByLink(pool).filter(it => looksLikeValidItemUrl(it.link));
}

/* ---------- render ---------- */

function cardHtml(item) {
  const href  = affiliateLink(item.link, item.customid); // direct ebay.com with tracking params
  const img   = fixImg(item.img) || "images/pic02.jpg";
  const title = (item.title || "eBay item").replace(/"/g, "&quot;");

  let priceHtml = "";
  if (item.price) {
    const showWas = item.was && item.was !== item.price;
    priceHtml = `<p><strong>${item.price}</strong>${showWas ? ` <del>${item.was}</del>` : ""}</p>`;
  }

  return `
    <div class="col-4 col-6-medium col-12-small">
      <section class="box">
        <a href="${href}" class="image featured" target="_blank" rel="nofollow sponsored noopener">
          <img src="${img}" alt="${title}" loading="lazy" />
        </a>
        <header><h3>${title}</h3></header>
        ${priceHtml}
        <footer>
          <a class="button icon solid fa-shopping-cart" href="${href}" target="_blank" rel="nofollow sponsored noopener">
            View on eBay
          </a>
        </footer>
      </section>
    </div>
  `;
}

/* ---------- hydrate ---------- */

// Tiered fill: 1) price+was, 2) price only, 3) any; up to data-limit (default 12)
async function hydrateGrid(gridId) {
  const el = document.getElementById(gridId);
  if (!el) return;

  // prevent double rendering
  if (el.dataset.hydrated === "1") return;
  el.dataset.hydrated = "1";

  const q = el.dataset.q || "wireless earbuds";
  const limit = parseInt(el.dataset.limit || "12", 10);
  el.innerHTML = "";

  try {
    const html  = await fetchSearchHtml(q);
    const pool  = parseSearchHtml(html, 200);

    const tier1 = pool.filter(it => it.price && it.was && it.was !== it.price);
    const tier2 = pool.filter(it => it.price && (!it.was || it.was === it.price));
    const tier3 = pool.filter(it => !it.price);

    const final = [];
    for (const t of [tier1, tier2, tier3]) {
      for (const it of t) {
        if (final.length >= limit) break;
        final.push(it);
      }
      if (final.length >= limit) break;
    }

    if (!final.length) {
      el.innerHTML = `<p>No items found right now.</p>`;
      return;
    }

    el.innerHTML = final.map(cardHtml).join("");
  } catch (e) {
    console.error(e);
    el.innerHTML = `<p>Couldn't load eBay deals right now.</p>`;
  }
}
