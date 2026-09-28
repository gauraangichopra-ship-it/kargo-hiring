import "server-only";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt"];

// Text only - photos and other images in the CV are never extracted.
export async function extractText(fileName: string, buf: Buffer): Promise<string> {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  let text: string;
  if (ext === ".pdf") {
    const parser = new PDFParse({ data: buf });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else if (ext === ".docx") {
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (ext === ".txt") {
    text = buf.toString("utf8");
  } else {
    throw new Error(`Unsupported file type "${ext}". Use PDF, DOCX or TXT.`);
  }
  text = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/-- \d+ of \d+ --/g, "") // pdf-parse page markers
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < 50) throw new Error("Could not read any text from this file (is it a scanned image?)");
  return text;
}
