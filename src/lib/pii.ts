// Privacy-critical: separates personal details from CV content.
// Pure, deterministic code - no AI is involved in finding or removing PII.

export type Pii = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: string[];
  // Every email/phone found (a CV can list more than one); all are redacted.
  allEmails: string[];
  allPhones: string[];
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Loose phone candidate; filtered by digit count below.
const PHONE_RE = /(?:\+\s?)?\(?\d[\d\s().-]{8,18}\d/g;
const LINK_RE =
  /\b(?:https?:\/\/[^\s<>()|,;]+|www\.[^\s<>()|,;]+|(?:[a-z]{2,3}\.)?(?:linkedin\.com|github\.com|behance\.net|medium\.com|twitter\.com|x\.com|notion\.site)\/[^\s<>()|,;]*)/gi;

const NOT_A_NAME =
  /^(resume|résumé|curriculum vitae|cv|profile|summary|contact|personal details|about me)$/i;

const CITIES = [
  "Mumbai", "Navi Mumbai", "Thane", "Pune", "Bengaluru", "Bangalore", "Delhi", "New Delhi",
  "Gurugram", "Gurgaon", "Noida", "Hyderabad", "Chennai", "Kolkata", "Ahmedabad", "Jaipur",
  "Kochi", "Chandigarh", "Indore", "Surat", "Vadodara", "Nagpur", "Lucknow", "Coimbatore",
  "Visakhapatnam", "Goa", "Singapore", "Dubai", "London",
];

const INSTITUTION_WORD = "(?:University|College|Institute|Polytechnic|Academy|School|Vidyalaya|Vidyapeeth)";
const CAP_WORD = "[A-Z][A-Za-z.&'’-]*";
const INSTITUTION_RE = new RegExp(
  // [ \t] not \s: an institution name never spans a line break.
  `\\b(?:${CAP_WORD}[ \\t]+){0,6}${INSTITUTION_WORD}\\b` +
    `(?:[ \\t]+of(?:[ \\t]+(?:${CAP_WORD}|and|&)){1,6})?` +
    `(?:[ \\t]*[,-][ \\t]*(?:${CITIES.join("|")}))?`,
  "g",
);
const INSTITUTION_ACRONYM_RE = new RegExp(
  "\\b(?:IIT|IIM|NIT|IIIT|BITS|ISB|XLRI|SPJIMR|NMIMS|JBIMS|FMS|MDI|IISc|DTU|NSUT|VJTI|COEP|SRCC|LSE|INSEAD|Wharton|Stanford|Harvard|MIT)\\b" +
    "(?:[ \\t,-]+(?:" + CITIES.join("|") + "|Bombay|Madras|Kanpur|Kharagpur|Roorkee|Guwahati|Pilani|Goa|Ahmedabad|Calcutta|Lucknow|Indore|Kozhikode|Trichy|Surathkal|Warangal))?",
  "g",
);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const digits = (s: string) => s.replace(/\D/g, "");

function findPhones(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(PHONE_RE) ?? []) {
    const d = digits(m);
    if (d.length < 10 || d.length > 15) continue;
    // Skip date ranges like "2019 - 2021 2023" and plain year lists.
    if (/^\s*(?:19|20)\d{2}\s*[-–]/.test(m)) continue;
    out.push(m.trim());
  }
  return [...new Set(out)];
}

function guessName(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8);
  for (let raw of lines) {
    raw = raw.replace(/^name\s*[:\-]\s*/i, "").split(/\s*[|•·,]\s*/)[0].trim();
    if (!raw || NOT_A_NAME.test(raw)) continue;
    if (/[@\d/]/.test(raw)) continue;
    const words = raw.split(/\s+/);
    if (words.length < 1 || words.length > 5) continue;
    if (!words.every((w) => /^[A-Za-z][A-Za-z.'’-]*$/.test(w))) continue;
    // Title-case or ALL CAPS names only; skip headings like "Product Manager".
    if (/\b(manager|product|engineer|lead|analyst|consultant|experience|objective)\b/i.test(raw)) continue;
    return words
      .map((w) => (w === w.toUpperCase() && w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w))
      .join(" ");
  }
  return null;
}

function guessLocation(text: string): string | null {
  const header = text.split("\n").slice(0, 8).join(" ");
  const city = CITIES.find((c) => new RegExp(`\\b${escapeRe(c)}\\b`, "i").test(header));
  return city ?? null;
}

export function extractPii(text: string): Pii {
  const allEmails = [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.trim()))];
  const allPhones = findPhones(text);
  const links = [...new Set((text.match(LINK_RE) ?? []).map((l) => l.replace(/[.)]+$/, "")))];
  return {
    full_name: guessName(text),
    email: allEmails[0] ?? null,
    phone: allPhones[0] ?? null,
    location: guessLocation(text),
    links,
    allEmails,
    allPhones,
  };
}

// Name parts worth redacting on their own ("Priya" or "Sharma" mentioned later).
function nameParts(name: string): string[] {
  return name.split(/\s+/).filter((p) => p.replace(/\W/g, "").length >= 3);
}

// Phone as a regex that tolerates any separators between digits.
function phonePattern(phone: string): RegExp {
  const d = digits(phone).slice(-10);
  return new RegExp(d.split("").join("[\\s().-]*"), "g");
}

export function redact(text: string, pii: Pii): string {
  let out = text;
  for (const e of pii.allEmails) out = out.replace(new RegExp(escapeRe(e), "gi"), "[EMAIL]");
  // Links before phones so digits inside URLs don't half-match.
  for (const l of [...pii.links].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(escapeRe(l), "gi"), "[LINK]");
  }
  for (const p of pii.allPhones) {
    // Include an optional country code prefix in the replacement.
    const re = new RegExp(`(?:\\+\\s?\\d{1,3}[\\s.-]*)?\\(?${phonePattern(p).source}`, "g");
    out = out.replace(re, "[PHONE]");
  }
  if (pii.full_name) {
    out = out.replace(new RegExp(escapeRe(pii.full_name), "gi"), "[CANDIDATE]");
    for (const part of nameParts(pii.full_name)) {
      out = out.replace(new RegExp(`\\b${escapeRe(part)}\\b`, "gi"), "[CANDIDATE]");
    }
    out = out.replace(/\[CANDIDATE\](?:\s+\[CANDIDATE\])+/g, "[CANDIDATE]");
  }
  out = out.replace(INSTITUTION_RE, "[INSTITUTION]").replace(INSTITUTION_ACRONYM_RE, "[INSTITUTION]");
  return out;
}

// Returns the list of PII strings still present. Empty list = safe to send to AI.
export function findLeaks(redacted: string, pii: Pii): string[] {
  const lower = redacted.toLowerCase();
  const leaks: string[] = [];
  for (const e of pii.allEmails) if (lower.includes(e.toLowerCase())) leaks.push("email");
  for (const l of pii.links) if (lower.includes(l.toLowerCase())) leaks.push("link");
  for (const p of pii.allPhones) if (phonePattern(p).test(redacted)) leaks.push("phone");
  if (pii.full_name) {
    for (const part of nameParts(pii.full_name)) {
      if (new RegExp(`\\b${escapeRe(part)}\\b`, "i").test(redacted)) leaks.push("name");
    }
  }
  if (new RegExp(EMAIL_RE.source, "i").test(redacted)) leaks.push("unrecognised email");
  return [...new Set(leaks)];
}
