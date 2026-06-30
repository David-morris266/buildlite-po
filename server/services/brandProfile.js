const fs = require("fs");
const path = require("path");
const { pool } = require("../db");

const BRAND_DIRS = [
  path.join(__dirname, "..", "brand"),
  path.join(__dirname, "..", "Brand"),
];

function readLogoAsDataUrl(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : "image/png";
    const b64 = fs.readFileSync(filePath).toString("base64");
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

function findFirstLogoFile() {
  for (const dir of BRAND_DIRS) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs
        .readdirSync(dir)
        .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
        .sort();
      if (files.length) return path.join(dir, files[0]);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function resolveLogoDataUrl(logoUrl) {
  if (logoUrl && String(logoUrl).startsWith("data:")) return logoUrl;
  if (logoUrl) {
    const candidates = [
      logoUrl,
      path.join(__dirname, "..", logoUrl),
      path.join(__dirname, "..", "brand", path.basename(logoUrl)),
      path.join(__dirname, "..", "Brand", path.basename(logoUrl)),
    ];
    for (const p of candidates) {
      const data = readLogoAsDataUrl(p);
      if (data) return data;
    }
  }
  const fallback = findFirstLogoFile();
  return fallback ? readLogoAsDataUrl(fallback) : null;
}

async function getBrandProfileForClient(clientId) {
  const { rows } = await pool.query(
    "select * from client_brand_profiles where client_id = $1",
    [clientId]
  );
  return rows[0] || null;
}

function mapBrandToPdfContext(brandRow, client) {
  const company =
    brandRow?.trading_name ||
    brandRow?.legal_name ||
    client?.name ||
    client?.code ||
    "BuildLite";

  const addressParts = [
    brandRow?.address_line1,
    brandRow?.address_line2,
    brandRow?.town,
    brandRow?.county,
    brandRow?.postcode,
  ].filter(Boolean);

  const logo = resolveLogoDataUrl(brandRow?.logo_url);

  return {
    company,
    address: addressParts.join(", "),
    companyNo: brandRow?.company_number || "",
    vatNo: brandRow?.vat_number || "",
    phone: brandRow?.phone || "",
    email: brandRow?.email || "",
    website: brandRow?.website || "",
    color: brandRow?.accent_color || "#1e233a",
    logo,
    showWordmark: !logo,
    shortName: brandRow?.trading_name || brandRow?.legal_name || company,
    strapline: brandRow?.pdf_footer_text || "",
  };
}

module.exports = {
  getBrandProfileForClient,
  mapBrandToPdfContext,
};
