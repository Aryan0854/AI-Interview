import mammoth from 'mammoth';
import { createRequire } from 'module';

const requireModule = createRequire(import.meta.url);

/**
 * Extracts raw text from a Word document (.docx)
 * @param buffer - File buffer
 * @returns Extracted raw text
 */
export const parseDocx = async (buffer: Buffer): Promise<string> => {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (err: any) {
    console.error('[Parser] Error parsing DOCX file:', err.message);
    throw new Error(`Failed to parse DOCX: ${err.message}`);
  }
};

/**
 * Extracts raw text from a PDF document (.pdf)
 * @param buffer - File buffer
 * @returns Extracted raw text
 */
export const parsePdf = async (buffer: Buffer): Promise<string> => {
  try {
    const pdfParseModule = requireModule("pdf-parse");
    const PDFParse = pdfParseModule.PDFParse;
    if (PDFParse && typeof PDFParse.setWorker === "function") {
      PDFParse.setWorker();
    }
    if (typeof PDFParse !== "function") {
      throw new Error("pdf-parse PDFParse API is unavailable");
    }
    const parser = new PDFParse({ data: Uint8Array.from(buffer) });
    try {
      const result = await parser.getText({
        itemJoiner: " ",
        cellSeparator: " ",
        lineEnforce: true,
      });
      return String(result?.text || "").replace(/[ \t]{2,}/g, " ").trim();
    } finally {
      if (typeof parser.destroy === "function") await parser.destroy();
    }
  } catch (err: any) {
    console.error('[Parser] Error parsing PDF file:', err.message);
    throw new Error(`Failed to parse PDF: ${err.message}`);
  }
};

/**
 * Automatically detects file type and extracts text
 * @param filename - Name of the file
 * @param buffer - File buffer
 * @returns Extracted raw text
 */
export const parseDocument = async (filename: string, buffer: Buffer): Promise<string> => {
  const ext = filename.split('.').pop()?.toLowerCase();
  
  console.log(`[Parser] Parsing document: ${filename} (extension: ${ext})`);

  if (ext === 'docx') {
    return await parseDocx(buffer);
  } else if (ext === 'pdf') {
    return await parsePdf(buffer);
  } else {
    throw new Error(`Unsupported file type: .${ext}. Only .docx and .pdf files are supported.`);
  }
};
