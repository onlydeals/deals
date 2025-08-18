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

function parseSearchHtml(html, limit = 9) {
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

function simpleCardHtml(item) {
  const href = roverLink(item.link, item.customid);
  const img  = item.img || "images/pic02.jpg";
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
async function hydrateGrid(gridId) {
  return hydrateGridSimple(gridId);
}
