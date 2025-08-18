// === config ===
const CAMPID = "5339119674";                          // your ePN id
const PROXY_BASE = "https://onlydeals-proxy.vercel.app/api/rss"; // yes, same path

function roverLink(rawUrl, customid="") {
  const u = new URL("https://rover.ebay.com/rover/1/711-53200-19255-0/1");
  u.searchParams.set("campid", CAMPID);
  u.searchParams.set("toolid", "10001");
  if (customid) u.searchParams.set("customid", customid);
  u.searchParams.set("mpre", rawUrl);
  return u.toString();
}

// Build an eBay **search HTML** URL (NO _rss=1)
function ebaySearchUrl(q) {
  const u = new URL("https://www.ebay.com/sch/i.html");
  u.searchParams.set("_nkw", q);
  u.searchParams.set("LH_BIN", "1");   // Buy It Now
  u.searchParams.set("_sop", "12");    // Newly listed
  u.searchParams.set("_ipg", "60");    // items per page
  return u.toString();
}

async function fetchSearchHtml(q) {
  const target = ebaySearchUrl(q);                             // <-- NO _rss
  const proxied = `${PROXY_BASE}?url=${encodeURIComponent(target)}`;
  console.log("Fetching via proxy:", proxied);
  const r = await fetch(proxied, { mode: "cors", cache: "no-store" });
  if (!r.ok) throw new Error("proxy status " + r.status);
  return await r.text();                                       // HTML
}

// Parse the HTML search results
function parseSearchHtml_old(html, limit = 9) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const cards = Array.from(doc.querySelectorAll("li.s-item")).slice(0, limit);
  const items = cards.map((li, idx) => {
    const a = li.querySelector("a.s-item__link");
    const imgEl = li.querySelector("img.s-item__image-img") || li.querySelector("img");
    const titleEl = li.querySelector(".s-item__title");
    const priceEl = li.querySelector(".s-item__price");

    const link  = a?.href || "#";
    const img   = imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src");
    const title = (titleEl?.textContent || "").replace(/^\s*New Listing\s*/i, "").trim() || "eBay item";
    const price = (priceEl?.textContent || "").trim();

    return { title, link, img, price, customid: "html_"+idx };
  });
  if (!items.length) throw new Error("No items parsed");
  return items;
}
function parseSearchHtml(html, limit = 9) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Narrow scope to the actual results container
  const results = doc.querySelector(".srp-results");
  if (!results) throw new Error("No .srp-results found");

  const cards = Array.from(results.querySelectorAll("li.s-item")).slice(0, limit);

  const items = cards.map((li, idx) => {
    const a = li.querySelector("a.s-item__link");
    const imgEl = li.querySelector("img.s-item__image-img") || li.querySelector("img");
    const titleEl = li.querySelector(".s-item__title");
    const priceEl = li.querySelector(".s-item__price");

    const link  = a?.href || "#";
    const img   = imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src");
    const title = (titleEl?.textContent || "").replace(/^\s*New Listing\s*/i, "").trim() || "eBay item";
    const price = (priceEl?.textContent || "").trim();

    return { title, link, img, price, customid: "html_"+idx };
  });

  if (!items.length) throw new Error("No valid items parsed");
  return items;
}



function cardHtml(item) {
  const href = roverLink(item.link, item.customid);
  const alt  = item.title.replace(/"/g, "&quot;");
  const priceLine = item.price ? `<p><strong>${item.price}</strong></p>` : "";
  const img = item.img || "images/pic02.jpg";
  return `
    <div class="col-4 col-6-medium col-12-small">
      <section class="box">
        <a href="${href}" class="image featured" target="_blank" rel="nofollow sponsored noopener">
          <img src="${img}" alt="${alt}" loading="lazy" />
        </a>
        <header><h3>${alt}</h3></header>
        ${priceLine}
        <footer>
          <a class="button icon solid fa-shopping-cart" href="${href}" target="_blank" rel="nofollow sponsored noopener">View on eBay</a>
        </footer>
      </section>
    </div>`;
}

async function hydrateGrid(gridId) {
  const el = document.getElementById(gridId);
  if (!el) return;
  const q = el.dataset.q || "wireless earbuds";
  try {
    const html  = await fetchSearchHtml(q);         // <-- fetch **HTML**
    const items = parseSearchHtml(html, 9);         // <-- parse **HTML**
    el.innerHTML = items.map(cardHtml).join("");
  } catch (err) {
    console.error(err);
    el.innerHTML = `<p>Couldn’t load eBay deals right now.</p>`;
  }
}
