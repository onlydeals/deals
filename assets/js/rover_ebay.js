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
  u.searchParams.set("_nkw", q);      // keywords
  u.searchParams.set("_sop", "12");   // newly listed
  u.searchParams.set("LH_BIN", "1");  // Buy It Now
  u.searchParams.set("_rss", "1");    // RSS output
  return u.toString();
}

// Use a CORS-friendly RSS->JSON service to avoid XML/CORS hassles
async function fetchFeed(url) {
  const api = "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(url);
  const r = await fetch(api);
  if (!r.ok) throw new Error("rss2json fetch failed: " + r.status);
  const data = await r.json();
  if (!data.items || !data.items.length) throw new Error("No RSS items");
  return data.items.map((it, idx) => {
    // Try enclosure > thumbnail > first <img> in content
    let img = it.enclosure?.link || it.thumbnail || null;
    if (!img && it.content) {
      const m = it.content.match(/<img[^>]+src="([^"]+)"/i);
      if (m) img = m[1];
    }
    return {
      title: it.title || "eBay deal",
      link: it.link,
      img,
      customid: "rss_" + idx,
    };
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
    const items = await fetchFeed(rssUrl);
    el.innerHTML = items.slice(0, 9).map(cardHtml).join("");
  } catch (err) {
    console.error("RSS hydrate error for", gridId, "→", err);
    el.innerHTML = `<p>Couldn’t load eBay deals right now.</p>`;
  }
}

// Auto-run on load
document.addEventListener("DOMContentLoaded", () => {
  ["deals-tech", "deals-home", "deals-fitness"].forEach(hydrateGrid);
});
