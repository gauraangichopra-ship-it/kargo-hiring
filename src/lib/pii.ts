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
  // Name tokens from the file name; redacted and leak-checked as a backstop.
  nameHints?: string[];
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Loose phone candidate; filtered by digit count below.
const PHONE_RE = /(?:\+\s?)?\(?\d[\d\s().-]{8,18}\d/g;
// Any web address: http(s)://…, www.…, or a bare domain with a common TLD
// (leetcode.com/handle, name.dev, portfolio.io/work). Emails are excluded by
// the (?<!@) lookbehind so they are left for EMAIL_RE. Case-sensitive on purpose:
// the TLD must be lowercase, so degrees like "B.Com" / "B.Tech" are not links.
const LINK_TLDS = "com|in|io|net|org|dev|me|co|ai|app|site|xyz|tech|page|so|link|bio|us|uk|ly";
const LINK_RE = new RegExp(
  `(?<![@\\w.-])(?:[Hh][Tt][Tt][Pp][Ss]?:\\/\\/[^\\s<>()|,;]+|[Ww]{3}\\.[^\\s<>()|,;]+|(?:[A-Za-z0-9-]+\\.)+(?:${LINK_TLDS})\\b(?:\\/[^\\s<>()|,;]*)?)`,
  "g",
);

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
  "\\b(?:IIT|IIM|NIT|IIIT|BITS|ISB|XLRI|SPJIMR|NMIMS|JBIMS|FMS|MDI|IMT|IIFT|TISS|SIBM|SCMHRD|SIMSR|MICA|NITIE|IISER|IISc|DTU|NSUT|VJTI|COEP|SRCC|LSR|XIM|XIMB|KJSIMSR|GLIM|TAPMI|IMI|VIT|SRM|LSE|INSEAD|Wharton|Stanford|Harvard|MIT|Kellogg|Booth|Columbia|Symbiosis|Amity|Manipal(?![ \\t]+Hospital)|NIRMA|Welingkar|Narsee Monjee)\\b" +
    "(?:[ \\t,-]+(?:" + CITIES.join("|") + "|Bombay|Madras|Kanpur|Kharagpur|Roorkee|Guwahati|Pilani|Goa|Ahmedabad|Calcutta|Lucknow|Indore|Kozhikode|Trichy|Surathkal|Warangal|Ghaziabad|Udaipur|Ranchi|Raipur|Shillong|Rohtak|Kashipur|Bhubaneswar|Jamshedpur|Manipal|Vellore|Chennai|Hyderabad|Mumbai|Delhi|Pune))?",
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

// Words that appear in CV headings / taglines / places and are never a person's name.
const NOT_NAME_WORDS = new Set(
  (
    "resume curriculum vitae cv profile summary contact personal details about me education experience " +
    "professional synopsis skills core competencies objective projects certifications certification achievements " +
    "scholastic academic qualifications publications research languages interests hobbies awards references " +
    "work employment history internships internship leadership responsibilities positions volunteering extracurricular " +
    "product manager senior associate lead head director engineer analyst consultant founder cofounder co-founder " +
    "strategy operations growth marketing sales business technology technical software data design program project " +
    "management executive officer intern india and of the for with to in at a an cross-functional scaling across ai ml " +
    "editor designer developer writer scientist specialist coordinator assistant trainee fellow member architect " +
    "researcher advisor partner owner president vice chief student graduate volunteer freelance freelancer " +
    "saas gtm platform tools key highlights selected relevant additional other"
  ).split(" "),
);
for (const c of CITIES) for (const w of c.toLowerCase().split(" ")) NOT_NAME_WORDS.add(w);

const titleCase = (w: string) => (w.length > 1 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w);

// A plausible "First Last" segment: 2-4 words, letters only, Title or UPPER case, no heading words.
function nameShaped(seg: string): string | null {
  const s = seg.replace(/^name\s*[:\-]\s*/i, "").trim();
  if (!s || s.length > 40 || /[@\d/:]/.test(s)) return null;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 4) return null;
  if (!words.every((w) => /^[A-Z][A-Za-z.'’-]*$/.test(w))) return null;
  if (words.some((w) => NOT_NAME_WORDS.has(w.toLowerCase().replace(/[.'’]/g, "")))) return null;
  return words.map(titleCase).join(" ");
}

// Name tokens suggested by the file name ("pm_03_deepika_nair.pdf" -> deepika, nair).
export function fileNameHints(fileName?: string): string[] {
  if (!fileName) return [];
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[^A-Za-z]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3 && !NOT_NAME_WORDS.has(w) && !/^(cv|resume|final|updated|spm|pm|new|copy)$/.test(w));
}

// Scores every name-shaped segment in the whole CV (PDF text layers often put
// the header block last). Prefers: file-name match, next to the email/phone
// line, written twice ("ROHAN MEHTA  Rohan Mehta"), near the top.
function guessName(text: string, hints: string[]): string | null {
  const lines = text.split("\n").map((l) => l.trim());
  const isContact = (l: string) => /@|\+?\d[\d\s-]{9,}/.test(l);
  const contactLines = lines.map((l, i) => (isContact(l) ? i : -1)).filter((i) => i >= 0);
  const nearContact = (i: number) => contactLines.some((c) => Math.abs(i - c) <= 2);
  let best: { name: string; score: number } | null = null;
  lines.forEach((line, i) => {
    // Strip emails, phones and links first: "Kabir Mehta squad_2@x.co" -> "Kabir Mehta".
    const cleaned = line
      .replace(new RegExp(EMAIL_RE.source, "gi"), "\t")
      .replace(new RegExp(LINK_RE.source, "g"), "\t")
      .replace(/(?:\+\s?)?\(?\d[\d\s().-]{8,18}\d/g, "\t");
    const segs = cleaned.split(/\t+|\s{3,}|\s*[|•·◦,]\s*/);
    for (const seg of segs) {
      const name = nameShaped(seg);
      if (!name) continue;
      const lower = name.toLowerCase();
      let score = 1;
      const matched = hints.filter((h) => lower.split(" ").includes(h)).length;
      score += matched * 5;
      if (nearContact(i)) score += 3;
      if (segs.filter((x) => x.trim().toLowerCase() === lower).length >= 2) score += 3;
      if (i < 5) score += 2;
      if (!best || score > best.score) best = { name, score };
    }
  });
  // Without any supporting signal, a lone Title Case pair is too weak to trust.
  return best && (best as { score: number }).score >= 3 ? (best as { name: string }).name : null;
}

function guessLocation(text: string): string | null {
  const header = text.split("\n").slice(0, 8).join(" ");
  const city = CITIES.find((c) => new RegExp(`\\b${escapeRe(c)}\\b`, "i").test(header));
  return city ?? null;
}

export function extractPii(text: string, fileName?: string): Pii {
  const allEmails = [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.trim()))];
  const allPhones = findPhones(text);
  const links = [...new Set((text.match(LINK_RE) ?? []).map((l) => l.replace(/[.)]+$/, "")))];
  const nameHints = fileNameHints(fileName);
  return {
    nameHints,
    full_name: guessName(text, nameHints),
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

// Every name token to hide: the detected name's parts plus file-name hints.
function allNameParts(pii: Pii): string[] {
  const parts = new Set<string>(pii.nameHints ?? []);
  if (pii.full_name) for (const p of nameParts(pii.full_name)) parts.add(p.toLowerCase());
  return [...parts];
}

// Handles built from the name: "rohan-mehta", "in/arjun-verma-pm", "priya_sharma".
function handleRe(pii: Pii): RegExp | null {
  const parts = pii.full_name ? pii.full_name.toLowerCase().split(/\s+/).filter(Boolean) : [];
  const hints = pii.nameHints ?? [];
  const seqs = [parts, hints].filter((p) => p.length > 1);
  if (!seqs.length) return null;
  const glued = seqs.map((p) => p.map(escapeRe).join("[._-]?")).join("|");
  return new RegExp(`(?:\\b(?:in|github|gh)/)?[A-Za-z0-9._-]*(?:${glued})[A-Za-z0-9._-]*`, "gi");
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
  const handles = handleRe(pii);
  if (handles) out = out.replace(handles, "[LINK]");
  if (pii.full_name) out = out.replace(new RegExp(escapeRe(pii.full_name), "gi"), "[CANDIDATE]");
  for (const part of allNameParts(pii)) {
    out = out.replace(new RegExp(`\\b${escapeRe(part)}\\b`, "gi"), "[CANDIDATE]");
  }
  out = out.replace(/\[CANDIDATE\](?:[ \t]+\[CANDIDATE\])+/g, "[CANDIDATE]");
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
  for (const part of allNameParts(pii)) {
    if (new RegExp(`\\b${escapeRe(part)}\\b`, "i").test(redacted)) leaks.push("name");
  }
  const handles = handleRe(pii);
  if (handles && new RegExp(handles.source, "i").test(redacted)) leaks.push("name in handle");
  // No name found at all = we can't prove the name is gone, so don't send it.
  if (!pii.full_name) leaks.push("name not identified");
  if (new RegExp(EMAIL_RE.source, "i").test(redacted)) leaks.push("unrecognised email");
  if (new RegExp(LINK_RE.source).test(redacted)) leaks.push("unrecognised link");
  return [...new Set(leaks)];
}
