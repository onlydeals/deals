const CAMPID = "5339119674"; // your ePN campaign id

function roverLink(rawUrl, customid="") {
  const u = new URL("https://rover.ebay.com/rover/1/711-53200-19255-0/1");
  u.searchParams.set("campid", CAMPID);
  u.searchParams.set("toolid", "10001");
  if (customid) u.searchParams.set("customid", customid);
  u.searchParams.set("mpre", rawUrl);
  return u.toString();
}

function ebayRssUrl(q) {
  const u = new URL("https://www.ebay.com/sch/i.html");
  u.searchParams.set("_nkw", q);     // keywords
  u.searchParams.set("_sop", "12");  // newly listed
  u.searchParams.set("LH_BIN", "1"); // Buy It Now
  u.searchParams.set("_rss", "1");   // RSS output
  return u.toString();
}

// --- CORS-friendly fetch via r.jina.ai (primary), fallbacks if needed ---
// async function fetchRss2(url) {
//   const endpoints = [
//     // ✅ try YOUR Vercel proxy FIRST
//     `https://onlydeals-proxy-kz83gw1bp-onlydeals-projects.vercel.app/api/rss?url=${encodeURIComponent(url)}`,

//     // fallbacks (only if proxy is down)
//     `https://r.jina.ai/https://${url.replace(/^https?:\/\//,'')}`,
//     `https://r.jina.ai/http://${url.replace(/^https?:\/\//,'')}`,
//     `https://cors.isomorphic-git.org/${url}`,
//     `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
//   ];

//   let lastErr;
//   for (const t of endpoints) {
//     try {
//       const r = await fetch(t, { mode: "cors" });
//       if (!r.ok) { lastErr = new Error(`status ${r.status}`); continue; }
//       const text = await r.text();

//       // 🔎 require real RSS/Atom before accepting
//       if (!text || text.length < 50) { lastErr = new Error("empty body"); continue; }
//       const looksXml = /<rss\b|<feed\b|<rdf:RDF\b|^<\?xml/i.test(text);
//       if (!looksXml) { lastErr = new Error("not rss/xml"); continue; }

//       return text;
//     } catch (e) {
//       lastErr = e;
//     }
//   }
//   throw lastErr || new Error("RSS fetch failed");
// }

async function fetchRss(url) {
  const proxy = `${PROXY_BASE}?url=${encodeURIComponent(url)}`;
  console.log("Fetching via proxy:", proxy); // <-- verify in Console

  const r = await fetch(proxy, { mode: "cors", cache: "no-store" });
  if (!r.ok) throw new Error("Proxy fetch failed: " + r.status);

  const text = await r.text();
  if (!/(<rss\b|<feed\b|<rdf:RDF\b|^<\?xml)/i.test(text)) {
    // log a snippet to help debug if it's not XML
    console.warn("Non-XML response (first 200 chars):", text.slice(0, 200));
    throw new Error("not rss/xml");
  }
  return text;
}
const PROXY_BASE = "https://onlydeals-proxy.vercel.app/api/rss"; // same path

function ebaySearchUrl(q) {
  const u = new URL("https://www.ebay.com/sch/i.html");
  u.searchParams.set("_nkw", q);
  u.searchParams.set("LH_BIN", "1"); // Buy It Now
  u.searchParams.set("_sop", "12");  // Newly listed
  u.searchParams.set("_ipg", "60");  // items per page (more to choose from)
  return u.toString();
}

async function fetchSearchHtml(q) {
  const url = ebaySearchUrl(q);
  const proxied = `${PROXY_BASE}?url=${encodeURIComponent(url)}`;
  console.log("Fetching via proxy:", proxied);
  const r = await fetch(proxied, { mode: "cors", cache: "no-store" });
  if (!r.ok) throw new Error("proxy status " + r.status);
  return await r.text();
}

function parseSearchHtml(html, limit = 9) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // eBay search cards
  const cards = Array.from(doc.querySelectorAll("li.s-item")).slice(0, limit);

  const items = cards.map((li, idx) => {
    const a = li.querySelector("a.s-item__link");
    const imgEl =
      li.querySelector("img.s-item__image-img") || li.querySelector("img");
    const titleEl = li.querySelector(".s-item__title");
    const priceEl = li.querySelector(".s-item__price");

    const link = a?.href || "#";
    const img = imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src");
    const title =
      (titleEl?.textContent || "").replace(/^\s*New Listing\s*/i, "").trim() ||
      "eBay item";
    const price = (priceEl?.textContent || "").trim();

    return { title, link, img, price, customid: "html_" + idx };
  });

  if (!items.length) throw new Error("No items parsed");
  return items;
}

function cardHtml(item) {
  const href = roverLink(item.link, item.customid);
  const alt = item.title.replace(/"/g, "&quot;");
  const price = item.price ? `<p><strong>${item.price}</strong></p>` : "";
  const img = item.img || "images/pic02.jpg";
  return `
    <div class="col-4 col-6-medium col-12-small">
      <section class="box">
        <a href="${href}" class="image featured" target="_blank" rel="nofollow sponsored noopener">
          <img src="${img}" alt="${alt}" loading="lazy" />
        </a>
        <header><h3>${alt}</h3></header>
        ${price}
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
    const html = await fetchSearchHtml(q);
    const items = parseSearchHtml(html, 9);
    el.innerHTML = items.map(cardHtml).join("");
  } catch (err) {
    console.error(err);
    el.innerHTML = `<p>Couldn’t load eBay deals right now.</p>`;
  }
}



function parseItems(xmlText, limit = 9) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const items = Array.from(doc.getElementsByTagName("item")).slice(0, limit);

  // If zero items, dump a snippet to console for debug
  if (!items.length) {
    console.warn("No <item> nodes. First 400 chars of response:", xmlText.slice(0, 400));
    return [];
  }

  return items.map((it, idx) => {
    const title = it.getElementsByTagName("title")[0]?.textContent?.trim() || "eBay deal";
    const link  = it.getElementsByTagName("link")[0]?.textContent?.trim() || "#";

    // Thumbnail candidates
    let img =
      it.querySelector("media\\:thumbnail")?.getAttribute("url") ||
      it.getElementsByTagName("thumbnail")[0]?.getAttribute?.("url") ||
      it.getElementsByTagName("enclosure")[0]?.getAttribute?.("url") ||
      null;

    if (!img) {
      const content = it.getElementsByTagName("content:encoded")[0]?.textContent || "";
      const m = content.match(/<img[^>]+src="([^"]+)"/i);
      if (m) img = m[1];
    }

    return { title, link, img, customid: "rss_"+idx };
  });
}

function cardHtml(item) {
  const href = roverLink(item.link, item.customid);
  const img  = item.img || "images/pic02.jpg";
  const alt  = item.title.replace(/"/g, "&quot;");
  return `
    <div class="col-4 col-6-medium col-12-small">
      <section class="box">
        <a href="${href}" class="image featured" target="_blank" rel="nofollow sponsored noopener">
          <img src="${img}" alt="${alt}" loading="lazy" />
        </a>
        <header><h3>${alt}</h3></header>
        <footer>
          <a class="button icon solid fa-shopping-cart" href="${href}" target="_blank" rel="nofollow sponsored noopener">
            View on eBay
          </a>
        </footer>
      </section>
    </div>`;
}

function setLoading(el) {
  el.innerHTML = `<div class="col-12"><p style="opacity:.7">Loading eBay deals…</p></div>`;
}

async function hydrateGrid(gridId) {
  const el = document.getElementById(gridId);
  if (!el) return;
  setLoading(el);
  const q = el.dataset.q || "wireless earbuds";
  const rssUrl = ebayRssUrl(q);

  try {
    const xml = await fetchRss(rssUrl);
    const items = parseItems(xml, 9);
    if (!items.length) throw new Error("No RSS items");
    el.innerHTML = items.map(cardHtml).join("");
  } catch (err) {
    console.error("RSS hydrate error for", gridId, "→", err);
    el.innerHTML = `<p>Couldn’t load eBay deals right now.</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  ["deals-tech", "deals-home", "deals-fitness"].forEach(hydrateGrid);
});
