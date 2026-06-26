import pdfParse from "pdf-parse";

// ── text extraction ──────────────────────────────────────────────────────────

async function extractText(buffer) {
  try {
    const data = await pdfParse(buffer);
    if (data.text && data.text.trim().length > 100) return data.text;
  } catch {}

  // fallback: tesseract OCR for scanned PDFs
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    const { data: { text } } = await worker.recognize(buffer);
    await worker.terminate();
    return text;
  } catch (err) {
    throw new Error("Could not extract text from PDF: " + err.message);
  }
}

// ── field parsers ────────────────────────────────────────────────────────────

function parseDebtorName(text) {
  // UCC-1 field 1a: look for debtor section
  const patterns = [
    /DEBTOR['’]?S?\s+(?:EXACT\s+)?(?:FULL\s+)?(?:LEGAL\s+)?NAME[^a-z]{0,30}\n+([^\n]+)/i,
    /1a\.\s*(?:ORGANIZATION['’]?S?\s+NAME\s*)?[\n\r]+([^\n\r]+)/i,
    /(?:ORGANIZATION NAME|ORG NAME)[:\s]+([^\n]+)/i,
    /DEBTOR[:\s]+([^\n]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function parseSecuredParty(text) {
  const patterns = [
    /SECURED\s+PARTY['’]?S?\s+(?:FULL\s+)?NAME[^a-z]{0,30}\n+([^\n]+)/i,
    /3a\.\s*(?:ORGANIZATION['’]?S?\s+NAME\s*)?[\n\r]+([^\n\r]+)/i,
    /SECURED\s+PARTY[:\s]+([^\n]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function parseRecordingDate(text) {
  // county stamps: "Filed: 05/19/2026", "Date Filed: ...", "Recorded:", "File Date:"
  const patterns = [
    /(?:filed|recorded|file\s+date|date\s+filed|filing\s+date)[:\s]+(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
    /(?:filed|recorded)[:\s]+(\w+ \d{1,2},?\s*\d{4})/i,
    /(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function parseFilingNumber(text) {
  const patterns = [
    /(?:filing\s+(?:number|no)|file\s+(?:number|no)|ucc\s+(?:number|no)|instrument\s+(?:number|no))[:\s#]+([A-Z0-9\-]+)/i,
    /(?:document\s+(?:number|no)|doc\s+(?:number|no))[:\s#]+([A-Z0-9\-]+)/i,
    /(?:receipt\s+(?:number|no))[:\s#]+([A-Z0-9\-]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function parseLoanAmount(text) {
  const m = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  return m ? "$" + m[1].trim() : null;
}

function parsePropertyAddress(text) {
  // look near "premises", "property address", "collateral address"
  const patterns = [
    /(?:premises|property\s+address|collateral\s+address|located\s+at)[:\s]+([^\n]{10,})/i,
    /(?:property|collateral)[:\s]*\n+([^\n]{10,})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function parseAttachments(text) {
  const referenced = [];
  const present = [];

  // common attachment keywords
  const keywords = ["schedule a", "schedule b", "exhibit a", "exhibit b", "addendum", "attachment"];

  for (const kw of keywords) {
    if (new RegExp(kw, "i").test(text)) {
      // if it says "see schedule a" or "schedule a attached" → referenced
      // if the actual content appears (multi-page) → present
      // simple heuristic: if mentioned → referenced; if content follows → present
      referenced.push(kw.replace(/\b\w/g, c => c.toUpperCase()));
      // check if there's actual content after the keyword (not just a reference line)
      const idx = text.toLowerCase().indexOf(kw);
      const after = text.slice(idx, idx + 200);
      if (after.split("\n").length > 3) {
        present.push(kw.replace(/\b\w/g, c => c.toUpperCase()));
      }
    }
  }

  return { referenced, present };
}

function isCountyRecording(text) {
  const lower = text.toLowerCase();
  // "county" anywhere → county recording
  if (/\bcounty\b/.test(lower)) return true;
  return false;
}

function parseRecordingOffice(text) {
  const m = text.match(/([A-Z][a-zA-Z\s]+ County [A-Za-z\s]+(?:Clerk|Recorder|Register)[^\n]*)/);
  if (m) return m[1].trim();
  // fallback: grab any line with "county clerk" or "county recorder"
  const m2 = text.match(/([^\n]*(?:county\s+(?:clerk|recorder|register))[^\n]*)/i);
  return m2 ? m2[1].trim() : null;
}

// ── main handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const text = await extractText(buffer);

    const attachments = parseAttachments(text);

    const parsed = {
      recordingDate: parseRecordingDate(text),
      debtorName: parseDebtorName(text),
      securedPartyName: parseSecuredParty(text),
      lenderName: parseSecuredParty(text),
      filingNumber: parseFilingNumber(text),
      loanAmount: parseLoanAmount(text),
      referencedAttachments: attachments.referenced,
      presentAttachments: attachments.present,
      propertyAddress: parsePropertyAddress(text),
      recordingLevel: isCountyRecording(text) ? "county" : "state",
      recordingOffice: parseRecordingOffice(text),
    };

    return Response.json({ success: true, data: parsed });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
