// ===== CONFIG =====
const CAMPID = "5339119674";
const PROXY_BASE = "https://onlydeals-proxy.vercel.app/api/rss"; // your Production domain

function roverLink(rawUrl, customid = "") {
  const u = new URL("https://rover.ebay.com/rover/1/711-53200-19255-0/1");
  u.searchParams.set("campid", CAMPID);
  u.searchParams.set("toolid", "10001");
  if (customid) u.searchParams.set("customid", customid);
  u.searchParams.set("mpre", rawUrl);
  return u.toString();
}

function ebaySearchUrl(q) {
  const u = new URL("https://www.ebay.com/sch/i.html");
  u.searchParams.set("_nkw", q);
  u.searchParams.set("LH_BIN", "1"); // Buy It Now
  u.searchParams.set("_sop", "12");  // Newly listed
  u.searchParams.set("_ipg", "60");  // more items on page
  return u.toString();
}

async function fetchSearchHtml(q) {
  const target = ebaySearchUrl(q);
  const proxied = `${PROXY_BASE}?url=${encodeURIComponent(target)}`;
  console.log("Fetching via proxy:", proxied);
  const r = await fetch(proxied, { mode: "cors", cache: "no-store" });
  if (!r.ok) throw new Error("proxy status " + r.status);
  return await r.text();
}

function parseSearchHtml_old(html, limit = 9) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const results = doc.querySelector(".srp-results");
  if (!results) throw new Error("No .srp-results found");

  const cards = Array.from(results.querySelectorAll("li.s-item"))
    // skip sponsored/ads
    .filter(li => !/Sponsored/i.test(li.textContent || ""))
    .slice(0, limit);

  console.log("Parsed item count:", cards.length);

  const items = cards.map((li, idx) => {
    const a = li.querySelector("a.s-item__link");
    const imgEl = li.querySelector("img.s-item__image-img") || li.querySelector("img");
    const titleEl = li.querySelector(".s-item__title");
    const priceEl = li.querySelector(".s-item__price");

    const link  = a?.href || "#";
    const img   = imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src");
    const title = (titleEl?.textContent || "").replace(/^\s*New Listing\s*/i, "").trim() || "eBay item";
    const price = (priceEl?.textContent || "").trim();

    return { title, link, img, price, customid: "html_" + idx };
  });

  if (!items.length) throw new Error("No valid items parsed");
  return items;
}
function parseSearchHtml(html, limit = 9) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // ---- 1) Try JSON-LD itemListElement (most robust) ----
  const ldScripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of ldScripts) {
    try {
      const json = JSON.parse(s.textContent || "null");
      // Look for a list with itemListElement (schema.org/SearchResultsPage style)
      const list = json && (json.itemListElement || (Array.isArray(json) && json.find(x => x.itemListElement)?.itemListElement));
      if (Array.isArray(list) && list.length) {
        const items = list
          .map((el, idx) => {
            const it = el.item || el; // some pages nest under item
            const title = it.name || "";
            const link  = it.url  || "";
            const img   = (it.image && (Array.isArray(it.image) ? it.image[0] : it.image)) || "";
            const offer = it.offers || {};
            const price = (offer.priceCurrency ? (offer.priceCurrency + " ") : "") + (offer.price || "");
            return { title, link, img, price, customid: "ldjson_"+idx };
          })
          .filter(x => x.link); // must have a url
        if (items.length) return items.slice(0, limit);
      }
    } catch (_) { /* ignore parse errors and continue */ }
  }

  // ---- 2) Fall back to DOM selectors inside results container ----
  // Try several containers eBay uses
  const containers = [
    doc.querySelector(".srp-results"),             // common
    doc.querySelector("#srp-river-results"),       // older
    doc.querySelector('[data-search-results]')     // safety
  ].filter(Boolean);

  for (const container of containers) {
    let cards = Array.from(container.querySelectorAll("li.s-item"));
    if (!cards.length) cards = Array.from(container.querySelectorAll("[data-view*='mi:'], [data-view*='iid:']"));

    // skip obvious ads/sponsored
    cards = cards.filter(li => !/Sponsored|AdChoice/i.test(li.textContent || ""));

    const items = cards.slice(0, limit).map((li, idx) => {
      const a = li.querySelector("a.s-item__link") || li.querySelector("a[href*='/itm/']");
      const imgEl = li.querySelector("img.s-item__image-img") || li.querySelector("img");
      const titleEl = li.querySelector(".s-item__title") || li.querySelector("[role='heading']");
      const priceEl = li.querySelector(".s-item__price") || li.querySelector("[data-testid='x-price']");

      const link  = a?.href || "";
      const img   = imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || "";
      const rawTitle = (titleEl?.textContent || "").trim();
      const title = rawTitle.replace(/^\s*New Listing\s*/i, "") || "eBay item";
      const price = (priceEl?.textContent || "").trim();

      return { title, link, img, price, customid: "html_"+idx };
    }).filter(x => x.link);

    if (items.length) return items.slice(0, limit);
  }

  // ---- 3) If still nothing, log a snippet to help debug and throw ----
  console.warn("Parser fallback: no results. First 300 chars:", html.slice(0, 300));
  throw new Error("No valid items parsed");
}


function simpleCardHtml_old(item) {
  const href = roverLink(item.link, item.customid);
  const img  = item.img || "../images/pic02.jpg";
  const price = item.price ? `<p><strong>${item.price}</strong></p>` : "";
  return `
    <div class="card">
      <a href="${href}" target="_blank" rel="nofollow sponsored noopener">
        <img src="${img}" alt="">
      </a>
      <h3>${item.title}</h3>
      ${price}
      <a class="button" href="${href}" target="_blank" rel="nofollow sponsored noopener">View on eBay</a>
    </div>
  `;
}

// Hydrator used by the test page
async function hydrateGridSimple(elId) {
  const el = document.getElementById(elId);
  const q = el?.dataset?.q || "wireless earbuds";
  if (!el) return;
  try {
    const html  = await fetchSearchHtml(q);
    const items = parseSearchHtml(html, 9);
    el.innerHTML = items.map(simpleCardHtml).join("");
  } catch (e) {
    console.error(e);
    el.innerHTML = `<p>Couldn't load eBay deals right now.</p>`;
  }
}

// Hydrator used by your main index if you prefer (same logic but expects the 3 columns)
async function hydrateGrid_old(gridId) {
  return hydrateGridSimple(gridId);
}




function simpleCardHtml(item) {
  const href = roverLink(item.link, item.customid);
  let img  = item.img || "../images/pic02.jpg";
  if (img.startsWith("//")) img = "https:" + img; // normalize protocol-relative
  const title = (item.title || "eBay item").replace(/"/g, "&quot;");
  const price = item.price ? `<p><strong>${item.price}</strong></p>` : "";
  return `
    <div class="col-4 col-6-medium col-12-small">
      <section class="box">
        <a href="${href}" class="image featured" target="_blank" rel="nofollow sponsored noopener">
          <img src="${img}" alt="${title}" loading="lazy" />
        </a>
        <header><h3>${title}</h3></header>
        ${price}
        <footer>
          <a class="button icon solid fa-shopping-cart" href="${href}" target="_blank" rel="nofollow sponsored noopener">
            View on eBay
          </a>
        </footer>
      </section>
    </div>
  `;
}

// Hydrator used by both test + main page
async function hydrateGrid(gridId) {
  const el = document.getElementById(gridId);
  if (!el) return;

  // prevent duplicates if something calls this twice
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
