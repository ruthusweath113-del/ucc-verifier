import Anthropic from "@anthropic-ai/sdk";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const fields = JSON.parse(formData.get("fields"));

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `You are a recorded mortgage document parser. Carefully analyze this document and extract the following fields. Return ONLY a valid JSON object with no markdown or preamble.

IMPORTANT CONTEXT RULES:
- "closingDate" is the DATED/execution date of the mortgage — NOT the recording date, NOT the maturity/due date
- "recordingDate" is the date stamped by the county clerk (found in the header/footer stamp on page 1 or last page)
- Do NOT confuse maturity dates, notary commission expiry dates, or other dates for these fields
- Borrower = Mortgagor = Debtor — all refer to the same party
- Lender = Mortgagee = Secured Party — all refer to the same party (note: Mortgagee may be MERS as nominee; in that case lenderName should be the actual lender named, e.g. "Funded Capital, LLC")
- Legal description is the LOT/BLOCK/PLAT/parcel text in Schedule A — it is NOT just the street address

{
  "recordingDate": "date from the county clerk recording stamp (format MM/DD/YYYY), null if not found",
  "recordingInstrumentNumber": "instrument/document number from the recording stamp, null if not found",
  "recordingCounty": "county name from the recording stamp, null if not found",
  "documentType": "exact title of the document (e.g. 'Commercial Mortgage, Security Agreement and Fixture Filing', 'Deed of Trust', 'Open End Mortgage'), null if not found",
  "isMortgageDocument": true or false — does the document type contain 'mortgage' or 'deed' (case insensitive),
  "closingDate": "the DATED/execution date of the mortgage (format MM/DD/YYYY), null if not found",
  "borrowerName": "borrower/mortgagor/debtor entity name, null if not found",
  "lenderName": "actual lender name (not MERS), null if not found",
  "mortgageeName": "mortgagee as stated in the document (may be MERS), null if not found",
  "returnToParty": "company name from the 'After Recording Return to' section, null if not found",
  "propertyAddress": "full property address from the document, null if not found",
  "loanAmount": "loan amount as stated in the document (e.g. '$325,000.00'), null if not found",
  "scheduleAPresent": true or false — is Schedule A present in the document,
  "legalDescriptionPresent": true or false — is there a legal description (LOT/BLOCK/PLAT/parcel text) in Schedule A, NOT just the street address,
  "legalDescription": "the legal description text from Schedule A if present, null if not found",
  "scheduleBPresent": true or false — is Schedule B present in the document,
  "scheduleBContent": "content of Schedule B (e.g. 'None', or list of encumbrances), null if not present",
  "borrowerSignaturePresent": true or false — is there a borrower/mortgagor signature on the signature page,
  "notarySignaturePresent": true or false — is there a notary public signature on the signature page,
  "notaryStampPresent": true or false — is there a notary stamp or seal on the signature page,
  "signaturePageClosingDate": "the bold/prominent date on the signature page (IN WITNESS WHEREOF date, format MM/DD/YYYY), null if not found",
  "totalPages": the total page count stated in the document (e.g. 21 from 'Page 1 of 21'), null if not found,
  "allPagesPresent": true or false — are all pages from 1 to totalPages present with no gaps
}

Return only the JSON object.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: prompt }
        ]
      }]
    });

    const text = response.content.map(b => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());

    return Response.json({ success: true, data: parsed });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
