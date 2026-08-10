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
    // Lazily load pdf-parse ONLY at runtime inside the function body.
    // This prevents browser polyfills from executing during Next.js static build pre-rendering,
    // solving "DOMMatrix is not defined" build compilation crashes!
    const pdfParse = requireModule('pdf-parse');
    const result = await pdfParse(buffer);
    return result.text || '';
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
