// Injected into the active tab by popup.js. The value of the last expression
// becomes the executeScript result, so this file is one big IIFE.
//
// JSON-LD first, meta tags second. No per-ATS CSS selectors - they break on
// every redesign and don't generalize to the next job board.
(() => {
  const text = (v) => (typeof v === "string" ? v.trim() : "");

  // A page can ship several JSON-LD blocks (breadcrumbs, org info, the job),
  // any of which may be an array or nested under @graph.
  const flatten = (data) => {
    const out = [];
    const walk = (node) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        out.push(node);
        if (node["@graph"]) walk(node["@graph"]);
      }
    };
    walk(data);
    return out;
  };

  const isJobPosting = (node) => {
    const t = node["@type"];
    return Array.isArray(t) ? t.includes("JobPosting") : t === "JobPosting";
  };

  const placeOf = (job) => {
    // jobLocation is often an array; addressLocality/Region are the useful bits.
    const loc = [].concat(job.jobLocation ?? [])[0];
    const addr = loc?.address ?? loc;
    const parts = [addr?.addressLocality, addr?.addressRegion, addr?.addressCountry]
      .map(text)
      .filter(Boolean);
    if (parts.length) return parts.join(", ");
    // ponytail: LinkedIn-style remote flag. Good enough until a real posting proves otherwise.
    return job.jobLocationType === "TELECOMMUTE" ? "Remote" : "";
  };

  const fromJsonLd = () => {
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      let parsed;
      try {
        parsed = JSON.parse(el.textContent);
      } catch {
        continue; // real sites ship malformed JSON-LD; one bad block isn't fatal
      }
      const job = flatten(parsed).find(isJobPosting);
      if (!job) continue;
      return {
        company: text(job.hiringOrganization?.name) || text(job.hiringOrganization),
        role: text(job.title),
        location: placeOf(job),
        date_posted: text(job.datePosted).slice(0, 10),
        found: "json-ld",
      };
    }
    return null;
  };

  const meta = (sel) => text(document.querySelector(sel)?.content);

  const fromMeta = () => ({
    company:
      meta('meta[property="og:site_name"]') ||
      location.hostname.replace(/^www\./, ""),
    role: meta('meta[property="og:title"]') || text(document.title),
    location: "",
    date_posted: "",
    found: "meta",
  });

  const job = fromJsonLd() ?? fromMeta();

  return {
    ...job,
    url: location.href, // the backend canonicalizes; don't duplicate that logic here
    source: location.hostname,
  };
})();
