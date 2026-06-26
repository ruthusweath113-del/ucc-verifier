// ── field parsers ────────────────────────────────────────────────────────────

function parseDebtorName(text) {
  const patterns = [
    // name on next line after "1a. ORGANIZATION'S NAME" (strict)
    /1[aA]\.?\s*ORGANIZATION['']?S?\s*NAME\s*[\r\n]+([^\r\n]{3,})/i,
    // OCR often reads "1" as "l" — handle "la."
    /[1lI][aA]\.?\s*ORGANIZATION['']?S?\s*NAME\s*[\r\n]+([^\r\n]{3,})/i,
    // name on same line after label
    /ORGANIZATION['']?S?\s*NAME[:\s]+([A-Z][^\r\n]{2,})/i,
    // broad: anything after "DEBTOR'S NAME" header block
    /DEBTOR['']?S?\s*NAME[^\r\n]{0,80}[\r\n]+([^\r\n]{3,})/i,
    // last resort: look for LLC/Corp/Inc near the top of the document
    /^([A-Z][A-Za-z0-9\s,.'&-]{3,}(?:LLC|L\.L\.C\.|INC|CORP|LTD|LP|LLP)\.?)\s*$/im,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    const val = m?.[1]?.trim();
    if (val && val.length > 2 && val.length < 100) return val;
  }
  return null;
}

function parseSecuredParty(text) {
  const patterns = [
    /3[aA]\.?\s*ORGANIZATION['']?S?\s*NAME\s*[\r\n]+([^\r\n]{3,})/i,
    /[3B]\.?\s*ORGANIZATION['']?S?\s*NAME\s*[\r\n]+([^\r\n]{3,})/i,
    /SECURED\s+PARTY['']?S?\s*(?:FULL\s+)?NAME[^\r\n]{0,80}[\r\n]+([^\r\n]{3,})/i,
    /SECURED\s+PARTY[:\s]+([A-Z][^\r\n]{2,})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    const val = m?.[1]?.trim();
    if (val && val.length > 2 && val.length < 100) return val;
  }
  return null;
}

function parseRecordingDate(text) {
  // county stamps: "05/26/2026 01:24:58 PM", "Filed: ...", "Recorded: ..."
  const patterns = [
    /(?:filed|recorded|file\s+date|date\s+filed|filing\s+date)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(\d{2}\/\d{2}\/\d{4})\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M/i, // timestamp format on county stamp
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
    /(?:filing\s+(?:number|no\.?)|file\s+(?:number|no\.?)|instrument\s+(?:number|no\.?))[:\s#]*([A-Z0-9\-]+)/i,
    /(?:document\s+(?:number|no\.?)|doc\.?\s+(?:number|no\.?))[:\s#]*([A-Z0-9\-]+)/i,
    /#\s*(\d{8,})/,  // bare # followed by 8+ digit number (e.g. #202610394)
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
    /(?:common\s+known\s+as|commonly\s+known\s+as|known\s+as)[:\s]+([^\n,]{5,}(?:,\s*[^\n]{3,}){1,3})/i,
    /(?:premises|property\s+address|collateral\s+address|located\s+at)[:\s]+([^\n]{10,})/i,
    /property\s+commonly\s+known\s+as[:\s]*([^\n]+)/i,
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
      // if the heading appears as its own line (actual page), mark present
      const headingRegex = new RegExp(`^\\s*${key}\\s*$`, "im");
      if (headingRegex.test(text)) present.push(label);
    }
  }

  return { referenced, present };
}

function isCountyRecording(text) {
  return /\bcounty\b/i.test(text);
}

function parseRecordingOffice(text) {
  const m = text.match(/(?:OFFICIAL\s+RECORDS?\s+)?([A-Z][A-Z\s]+COUNTY[^\n,]*)/i);
  return m ? m[1].trim() : null;
}

// ── main handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const { text, fields } = await request.json();

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
