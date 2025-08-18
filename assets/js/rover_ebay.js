// ===== ONLYDEALS eBay loader (no API) =====

// Your eBay Partner Network campaign id
const CAMPID = "5339119674";

// Your deployed proxy (Vercel/Cloudflare/etc.)
const PROXY_BASE = "https://onlydeals-proxy.vercel.app/api/rss";

// Build a Rover affiliate link around a raw eBay URL
function roverLink(rawUrl, customid = "") {
  const u = new URL("https://rover.ebay.com/rover/1/711-53200-19255-0/1");
  u.searchParams.set("campid", CAMPID);
  u.searchParams.set("toolid", "10001");
  if (customid) u.searchParams.set("customid", customid);
  u.searchParams.set("mpre", rawUrl);
  return u.toString();
}

// Build an eBay search URL
function ebaySearchUrl(q) {
  const u = new URL("https://www.ebay.com/sch/i.html");
  u.searchParams.set("_nkw", q);
  u.searchParams.set("LH_BIN", "1"); // Buy It Now
  u.searchParams.set("_sop", "12");  // Newly listed
  u.searchParams.set("_ipg", "60");  // more items
  return u.toString();
}

// Fetch the HTML of the eBay search page via your proxy
async function fetchSearchHtml(q) {
  const target = ebaySearchUrl(q);
  const proxied = `${PROXY_BASE}?url=${encodeURIComponent(target)}`;
  // console.log("Fetching via proxy:", proxied);
  const r = await fetch(proxied, { mode: "cors", cache: "no-store" });
  if (!r.ok) throw new Error("proxy status " + r.status);
  return await r.text();
}

// Parse items out of the eBay search HTML (tries JSON-LD first, then DOM)
function parseSearchHtml(html, limit = 9) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // ---- 1) JSON-LD (schema.org) ----
  const ldScripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of ldScripts) {
    try {
      const json = JSON.parse(s.textContent || "null");
      const list = json && (json.itemListElement || (Array.isArray(json) && json.find(x => x.itemListElement)?.itemListElement));
      if (Array.isArray(list) && list.length) {
        const items = list
          .map((el, idx) => {
            const it = el.item || el;
            const title = it.name || "";
            const link  = it.url  || "";
            const img   = (it.image && (Array.isArray(it.image) ? it.image[0] : it.image)) || "";
            const offer = it.offers || {};
            const price = (offer.priceCurrency ? (offer.priceCurrency + " ") : "") + (offer.price || "");
            return { title, link, img, price, customid: "ldjson_"+idx };
          })
          .filter(x => x.link);
        if (items.length) return items.slice(0, limit);
      }
    } catch { /* ignore */ }
  }

  // ---- 2) DOM fallbacks ----
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

    const items = cards.slice(0, limit).map((li, idx) => {
      const a       = li.querySelector("a.s-item__link") || li.querySelector("a[href*='/itm/']");
      const imgEl   = li.querySelector("img.s-item__image-img") || li.querySelector("img");
      const titleEl = li.querySelector(".s-item__title") || li.querySelector("[role='heading']");
      const priceEl = li.querySelector(".s-item__price") || li.querySelector("[data-testid='x-price']");
      // common “was/original” price selectors:
      const origEl  = li.querySelector(".s-item__original-price, .s-item__trending-price, .s-item__was-price, .STRIKETHROUGH");

      const link   = a?.href || "";
      const img    = imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || "";
      const title  = (titleEl?.textContent || "").replace(/^\s*New Listing\s*/i, "").trim() || "eBay item";
      const price  = (priceEl?.textContent || "").trim();
      const was    = (origEl?.textContent || "").trim();

      return { title, link, img, price, was, customid: "html_"+idx };
    }).filter(x => x.link);

    if (items.length) return items.slice(0, limit);
  }

  // ---- 3) Nothing found ----
  console.warn("Parser fallback: no results. First 300 chars:", html.slice(0, 300));
  throw new Error("No valid items parsed");
}

// Render one item as a Dopetrope-style card
function simpleCardHtml(item) {
  const href  = roverLink(item.link, item.customid);
  let img     = item.img || "images/pic02.jpg";      // relative to the page (index.html)
  if (img.startsWith("//")) img = "https:" + img;    // normalize protocol-relative
  const title = (item.title || "eBay item").replace(/"/g, "&quot;");

  // price + optional crossed-out “was”
  let priceHtml = "";
  if (item.price) {
    const was = item.was && item.was !== item.price ? ` <del>${item.was}</del>` : "";
    priceHtml = `<p><strong>${item.price}</strong>${was}</p>`;
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

// Hydrate a grid container (id) with items for its data-q
async function hydrateGrid(gridId) {
  const el = document.getElementById(gridId);
  if (!el) return;

  // prevent double rendering
  if (el.dataset.hydrated === "1") return;
  el.dataset.hydrated = "1";

  const q = el.dataset.q || "wireless earbuds";
  el.innerHTML = ""; // clear before render

  try {
    const html  = await fetchSearchHtml(q);
    const items = parseSearchHtml(html, 9);
    el.innerHTML = items.map(simpleCardHtml).join("");
  } catch (e) {
    console.error(e);
    el.innerHTML = `<p>Couldn't load eBay deals right now.</p>`;
  }
}
