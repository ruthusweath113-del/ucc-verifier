import Anthropic from "@anthropic-ai/sdk";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const fields = JSON.parse(formData.get("fields"));

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `You are an Assignment of Leases and Rents (ALR) document parser. Carefully analyze this document and extract the following fields. Return ONLY a valid JSON object with no markdown or preamble.

IMPORTANT CONTEXT RULES:
- "closingDate" is the DATED/execution date of the document — NOT the recording date, NOT any maturity/due date
- "recordingDate" is the date the document was recorded by the county clerk — it may appear as a stamp, cover sheet, header, or embedded recording info anywhere in the document
- "isRecorded" should be true if there is ANY evidence of recording: instrument number, recording stamp, county clerk info, cover sheet recording info, receipt number, or recorded/file date
- Assignor = Borrower = Mortgagor — all refer to the same party (the entity assigning the leases)
- Assignee = Lender = Mortgagee — all refer to the party receiving the assignment
- Legal description can appear ANYWHERE in the document — inside Schedule A, on a separate page titled "Legal Description", or anywhere else. It is text describing the property by lot/block/parcel/unit — NOT just a street address
- "documentType" should reflect the actual title (e.g. "Collateral Assignment of Leases and Rents", "Assignment of Rents", etc.)
- "isALRDocument" should be true if the document type contains "assignment" and ("lease" or "rent")

{
  "isRecorded": true or false — is there any evidence this document has been recorded,
  "recordingDate": "recording date if found (format MM/DD/YYYY), null if not found",
  "recordingInstrumentNumber": "instrument/document number from recording info, null if not found",
  "recordingCounty": "county name from recording info, null if not found",
  "documentType": "exact title of the document, null if not found",
  "isALRDocument": true or false — does document type relate to assignment of leases/rents,
  "closingDate": "the DATED/execution date (format MM/DD/YYYY), null if not found",
  "assignorName": "assignor/borrower entity name, null if not found",
  "assigneeName": "assignee/lender entity name, null if not found",
  "returnToParty": "company name from the 'After Recording Return to' section, null if not found",
  "propertyAddress": "full property address from the document, null if not found",
  "loanAmount": "loan amount as stated in the document (e.g. '$152,250.00'), null if not found",
  "scheduleAPresent": true or false — is Schedule A present,
  "legalDescriptionPresent": true or false — is there a legal description (lot/block/parcel/unit/condominium text) ANYWHERE in the document — NOT just a street address,
  "scheduleBPresent": true or false — is Schedule B present,
  "scheduleBContent": "content of Schedule B, null if not present",
  "assignorSignaturePresent": true or false — is there an assignor/borrower signature,
  "notarySignaturePresent": true or false — is there a notary public signature,
  "notaryStampPresent": true or false — is there a notary stamp or seal,
  "signaturePageClosingDate": "the bold/prominent date on the signature page (IN WITNESS WHEREOF date, format MM/DD/YYYY), null if not found",
  "totalPages": the total page count of the actual document (excluding cover sheets if separately numbered), null if not found,
  "allPagesPresent": true or false — are all document pages present with no gaps
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
