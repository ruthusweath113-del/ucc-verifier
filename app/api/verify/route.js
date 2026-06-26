// ── field parsers ────────────────────────────────────────────────────────────

function parseDebtorName(text) {
  const patterns = [
    // NYC City Register format: "DEBTOR: NAME\n"
    /DEBTOR:\s*[\r\n]+([^\r\n]{3,})/i,
    /DEBTOR:\s+([A-Z][^\r\n]{2,})/i,
    // Standard UCC-1 form: "1a. ORGANIZATION'S NAME" then name on next line
    /1[aA]\.?\s*ORGANIZATION['']?S?\s*NAME\s*[\r\n]+([^\r\n]{3,})/i,
    /[lL][aA]\.?\s*ORGANIZATION['']?S?\s*NAME\s*[\r\n]+([^\r\n]{3,})/i,
    // Name on same line as label
    /ORGANIZATION['']?S?\s*NAME[:\s]+([A-Z][^\r\n]{2,})/i,
    // Broad debtor header
    /DEBTOR['']?S?\s*(?:EXACT\s+)?(?:FULL\s+)?(?:LEGAL\s+)?NAME\s*[\r\n]+([^\r\n]{3,})/i,
    // Last resort: standalone LLC/Inc line
    /^([A-Z][A-Za-z0-9\s,.'&-]{2,}(?:LLC|L\.L\.C\.|INC\.?|CORP\.?|LTD\.?|LP|LLP)\.?)\s*$/im,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    const val = m?.[1]?.trim();
    if (val && val.length > 2 && val.length < 120) return val;
  }
  return null;
}

function parseSecuredParty(text) {
  const patterns = [
    // NYC City Register: "SECURED PARTY: NAME" or "SEC PARTY:"
    /SECURED\s+PARTY:\s*[\r\n]+([^\r\n]{3,})/i,
    /SECURED\s+PARTY:\s+([A-Z][^\r\n]{2,})/i,
    // Standard UCC-1 form field 3a
    /3[aA]\.?\s*ORGANIZATION['']?S?\s*NAME\s*[\r\n]+([^\r\n]{3,})/i,
    /SECURED\s+PARTY['']?S?\s*(?:FULL\s+)?NAME\s*[\r\n]+([^\r\n]{3,})/i,
    /SECURED\s+PARTY['']?S?\s*NAME[:\s]+([A-Z][^\r\n]{2,})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    const val = m?.[1]?.trim();
    if (val && val.length > 2 && val.length < 120) return val;
  }
  return null;
}

function parseRecordingDate(text) {
  const patterns = [
    // NYC format: "Document Date: 06-06-2025" or "Preparation Date:"
    /Document\s+Date:\s*(\d{2}[-\/]\d{2}[-\/]\d{4})/i,
    /(?:filed|recorded|file\s+date|date\s+filed|filing\s+date)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    // Timestamp on county stamp: "05/26/2026 01:24:58 PM"
    /(\d{2}\/\d{2}\/\d{4})\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M/i,
    /(?:filed|recorded)[:\s]+(\w+\.?\s+\d{1,2},?\s*\d{4})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function parseFilingNumber(text) {
  const patterns = [
    // NYC format: "Document ID: 2025061600587003"
    /Document\s+ID:\s*([0-9A-Z\-]{6,})/i,
    /(?:filing|file|instrument|document)\s+(?:number|no\.?|#)[:\s#]*([A-Z0-9\-]{4,})/i,
    /(?:receipt\s+(?:number|no\.?|#))[:\s]*([A-Z0-9\-]{4,})/i,
    // Bare # followed by 8+ digits (e.g. #202610394)
    /#\s*(\d{8,})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function parseReceiptNumber(text) {
  const m = text.match(/receipt\s*#?\s*(\d+)/i);
  return m ? m[1].trim() : null;
}

function parseLoanAmount(text) {
  const m = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  return m ? "$" + m[1].trim() : null;
}

function parsePropertyAddress(text) {
  const patterns = [
    // NYC format: address line under PROPERTY DATA section
    /(?:PROPERTY DATA|Address)[^\r\n]{0,60}[\r\n]+(?:[^\r\n]+[\r\n]+){0,3}(\d+\s+[A-Z][A-Z\s]+(?:STREET|AVE(?:NUE)?|BLVD|BOULEVARD|DR(?:IVE)?|RD|ROAD|CT|COURT|LN|LANE|WAY|PLACE|PL|TERRACE|TERR))/i,
    // Standalone street address line
    /(\d+\s+[A-Z][A-Z\s]{2,}(?:STREET|AVE(?:NUE)?|BLVD|BOULEVARD|DRIVE|ROAD|COURT|LANE|TERRACE|PLACE|WAY))/i,
    // Common labels
    /(?:premises|property\s+address|collateral\s+address|located\s+at|known\s+as)[:\s]+([^\r\n]{10,})/i,
    /property\s+commonly\s+known\s+as[:\s]*([^\r\n]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    const val = m?.[1]?.trim();
    if (val && val.length > 5) return val;
  }
  return null;
}

function parseAttachments(text) {
  const referenced = [];
  const present = [];
  const keywords = [
    { key: "schedule a", label: "Schedule A" },
    { key: "schedule b", label: "Schedule B" },
    { key: "exhibit a", label: "Exhibit A" },
    { key: "exhibit b", label: "Exhibit B" },
    { key: "addendum", label: "Addendum" },
  ];
  for (const { key, label } of keywords) {
    const regex = new RegExp(key.replace(" ", "\\s+"), "i");
    if (regex.test(text)) {
      referenced.push(label);
      const headingRegex = new RegExp(`^\\s*${key}\\s*$`, "im");
      if (headingRegex.test(text)) present.push(label);
    }
  }
  return { referenced, present };
}

function isCountyRecording(text) {
  // "county" anywhere — standard county clerk
  if (/\bcounty\b/i.test(text)) return true;
  // NYC City Register = county-level recorder (covers 5 boroughs)
  if (/city\s+register|department\s+of\s+finance/i.test(text)) return true;
  return false;
}

function parseRecordingOffice(text) {
  // NYC
  const nyc = text.match(/NYC\s+DEPARTMENT\s+OF\s+FINANCE[^\r\n]*/i);
  if (nyc) return nyc[0].trim();
  // Standard county
  const county = text.match(/([A-Z][A-Z\s]+COUNTY\s+(?:CLERK|RECORDER|REGISTER|CHANCERY)[^\r\n]*)/i);
  if (county) return county[1].trim();
  const office = text.match(/OFFICIAL\s+RECORDS?\s+([A-Z][A-Z\s]+COUNTY)/i);
  if (office) return office[1].trim();
  return null;
}

// ── main handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const { text } = await request.json();

    if (!text || text.trim().length < 20) {
      return Response.json({ success: false, error: "No text received from document." }, { status: 400 });
    }

    const attachments = parseAttachments(text);

    const parsed = {
      recordingDate: parseRecordingDate(text),
      debtorName: parseDebtorName(text),
      securedPartyName: parseSecuredParty(text),
      lenderName: parseSecuredParty(text),
      filingNumber: parseFilingNumber(text),
      receiptNumber: parseReceiptNumber(text),
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
