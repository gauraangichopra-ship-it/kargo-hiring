// Shared by the server (send) and the UI (preview) so both show the same text.
import { ROLE_TITLE, type Role } from "./types";

export function fillPlaceholders(text: string, name: string, role: Role): string {
  return text.replaceAll("[NAME]", name).replaceAll("[ROLE]", ROLE_TITLE[role]);
}

// Any [SOMETHING] left after substitution blocks the send.
export const LEFTOVER_PLACEHOLDER = /\[[^\]\n]{1,40}\]/;
