// Tunable constants. Change here, nowhere else.

// Top N per applied role are recommended for interview.
export const TOP_N_INVITE = 5;
// Anyone within this many points of the #N score is flagged "Needs your call".
export const REVIEW_BAND_POINTS = 5;
// A criterion whose quote can't be found in the CV is capped at this score.
export const UNVERIFIED_QUOTE_CAP = 3;
// Upload queue: files processed in parallel from the browser.
export const UPLOAD_CONCURRENCY = 3;
export const MAX_FILES_PER_BATCH = 60;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// The brief asks for an optional Gemini call to confirm the candidate's name
// from the first 3 lines of the CV. Those lines ARE personal data, which
// conflicts with "Gemini never receives name, email, phone, links", so it is
// off by default and the name comes from deterministic code only. If turned
// on, email/phone/links are stripped from those lines before the call.
export const CONFIRM_NAME_WITH_AI = false;
