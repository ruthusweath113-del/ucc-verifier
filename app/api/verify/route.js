import Anthropic from "@anthropic-ai/sdk";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const fields = JSON.parse(formData.get("fields"));

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `You are a UCC document parser. Extract the following from this UCC county filing document and return ONLY a JSON object with no markdown or preamble:
{
  "recordingDate": "the Filed date from the recording/cover page (format MM/DD/YYYY)",
  "debtorName": "debtor organization name from field 1a",
  "securedPartyName": "secured party organization name from field 3a",
  "lenderName": "full secured party name including any series designation",
  "seriesNumber": "series number if present in secured party name else null",
  "uccNumber": "UCC number or filing number",
  "receiptNumber": "receipt number if present",
  "loanAmount": "loan amount if mentioned anywhere in the document else null",
  "referencedAttachments": ["list of attachments referenced in the document e.g. Schedule A, Exhibit A"],
  "presentAttachments": ["list of attachments that are actually present/included in the document"],
  "propertyAddress": "full property address or premises from the document",
  "recordingLevel": "county or state — where was this UCC filed? Look for county clerk, county recorder, or similar. If filed with Secretary of State or state-level office, return 'state'. If filed with a county clerk or county recorder, return 'county'",
  "recordingOffice": "name of the recording office e.g. 'Hillsborough County Clerk' or 'Secretary of State'"
}
Return only the JSON object.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
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