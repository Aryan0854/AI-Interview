export async function extractPdfText(buffer: Buffer): Promise<string> {
  if (!buffer || buffer.length === 0) {
    throw new Error("Cannot parse empty PDF buffer.");
  }

  const pdfParseModule = require("pdf-parse");

  if (typeof pdfParseModule.PDFParse === "function") {
    const parser = new pdfParseModule.PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result?.text || "";
    } finally {
      if (typeof parser.destroy === "function") await parser.destroy();
    }
  }

  if (typeof pdfParseModule.default === "function") {
    const data = await pdfParseModule.default(buffer);
    return data.text || "";
  }

  if (typeof pdfParseModule === "function") {
    const data = await pdfParseModule(buffer);
    return data.text || "";
  }

  throw new Error(`Invalid pdf-parse module format: ${Object.keys(pdfParseModule).join(", ")}`);
}
