/**
 * Seed the "AHPRA OBA Pathway" process template into the Operations module.
 *
 * SOURCE: "AHPRA OBA steps.xls" (58 steps / 12 phases), cleaned + gap-filled
 * on 2026-07-09 (phase-name typos fixed, task-type casing normalized, 17 blank
 * flag rows filled, 4 conditional steps' branch source inferred).
 *
 * FIELD MAPPING: ProcessTemplateStep stores only name/description/phase/
 * isRequired/slaDays. The sheet's extra columns (task_type, message template,
 * conditional/proof/approval flags) are folded into a trailing
 * "-- Actor: ... - Template: ... - Target: ..." line on each step description.
 *
 * SLA MODEL (rolling turnaround): slaDays is the PER-STEP turnaround in working
 * days, measured from the PREVIOUS step's actual completion -- "2 Hours"/"1
 * Hours" -> 0 (same day), "24 Hours" -> 1, "1 to 7 days" -> 7, "1-6 months" ->
 * 180, Daily/Weekly monitors -> 0. The module chains these forward from
 * enrolment as a PROVISIONAL forecast (rollForwardDueDates), then recomputes the
 * open tail from each real completion date (recomputeSchedule) -- so an external
 * wait that resolves early pulls every downstream due date in and the unused
 * estimate is never carried forward. Provisional end-to-end span ~1067
 * working days (~35.1 months), dominated by the "1-6
 * month" AHPRA/visa wait estimates. The 4 conditional steps (15, 21, 27, 42) are
 * isRequired:false so the project can auto-complete without them.
 *
 * IDEMPOTENT: upserts one template per (service, name) and each step by
 * (templateId, seq); keeps it the sole active template for the service. Safe to
 * re-run. Does NOT create the Service -- run `npm run db:migrate-services` first
 * if the "AHPRA OBA Pathway" service row is missing.
 *
 *   npx tsx prisma/seed-ahpra-oba-template.ts             (apply)
 *   npx tsx prisma/seed-ahpra-oba-template.ts --dry-run   (report only)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry-run");

const SERVICE_NAME = "AHPRA OBA Pathway";
const TEMPLATE_NAME = "AHPRA OBA Pathway Process";
const TEMPLATE_DESCRIPTION =
  "AHPRA Outcomes-Based Assessment (OBA) nursing-registration pathway for internationally qualified nurses: intake, document collection, AHPRA account & portfolio, Decision Letter, ATT/NCLEX, visitor visa, OSCE, and final registration. 58 steps across 12 phases. Source: \"AHPRA OBA steps.xls\", cleaned and gap-filled 2026-07-09.";

type SeedStep = {
  seq: number;
  phase: string;
  name: string;
  isRequired: boolean;
  slaDays: number | null;
  description: string;
};

const STEPS: SeedStep[] = [
  { seq: 1, phase: "Candidate Intake", name: "Draft and send agreement", isRequired: true, slaDays: 0, description: "Create the service agreement and send it to the sales team. Check DESMA Connect regularly and follow up with the sales team if the signed agreement has not been received.\n\n\u2014 Actor: Internal \u00b7 Template: Service Agreement Template \u00b7 Target: 2 Hours" },
  { seq: 2, phase: "Candidate Intake", name: "Create WhatsApp group", isRequired: true, slaDays: 0, description: "Create a WhatsApp group including the documentation team member, the candidate, Devika, and Shibin. Send the introduction message and share the document checklist informing the candidate of all documents required to begin the process.\n\n\u2014 Actor: Internal \u00b7 Template: Introduction Message Template, Document Checklist \u00b7 Target: 1 Hours" },
  { seq: 3, phase: "Document Collection", name: "Receive signed agreement", isRequired: true, slaDays: 1, description: "Once the signed agreement is received, acknowledge receipt via email and WhatsApp, and update DESMA Connect.\n\n\u2014 Actor: Candidate \u00b7 Template: Agreement Receipt Acknowledgement Template \u00b7 Target: 24 Hours" },
  { seq: 4, phase: "Document Collection", name: "Send checklist and request candidate email ID", isRequired: true, slaDays: 0, description: "Send the document checklist to the candidate and request a new email ID to be used for the AHPRA process.\n\n\u2014 Actor: Internal \u00b7 Template: WhatsApp Message Template, Document Checklist \u00b7 Target: 2 Hours \u00b7 Proof required" },
  { seq: 5, phase: "Document Collection", name: "Receive required documents and candidate's new email address", isRequired: true, slaDays: 1, description: "Acknowledge receipt of the required documents and the candidate's new email address. Upload the documents to DESMA Connect and check whether any required documents are missing.\n\n\u2014 Actor: Candidate \u00b7 Template: Checklist and New Email ID Request Template \u00b7 Target: 24 Hours" },
  { seq: 6, phase: "Process Details & Guidance", name: "Share full process details via email and message", isRequired: true, slaDays: 1, description: "After the initial payment of \u20b968,440 is completed, share the complete process guide, next steps, show money requirements, and payment details with the candidate by email and message.\n\n\u2014 Actor: Internal \u00b7 Template: Complete Process Guidance Template \u00b7 Target: 24 Hours" },
  { seq: 7, phase: "AHPRA Account & Application", name: "Create AHPRA account", isRequired: true, slaDays: 1, description: "Using the candidate's new email ID, create the AHPRA login account and enter all candidate details accurately as per the submitted documents. Update DESMA Connect with the account details once created.\n\n\u2014 Actor: Internal \u00b7 Template: AHPRA Account Creation Template \u00b7 Target: 24 Hours" },
  { seq: 8, phase: "AHPRA Account & Application", name: "Send application fee payment link", isRequired: true, slaDays: 0, description: "Send the AHPRA application fee payment link to the candidate along with clear instructions on how to complete the 410 AUD payment.\n\n\u2014 Actor: Internal \u00b7 Template: AHPRA 410 AUD Payment Template \u00b7 Target: 2 Hours \u00b7 Proof required" },
  { seq: 9, phase: "AHPRA Account & Application", name: "Receive 410 AUD payment confirmation", isRequired: true, slaDays: 7, description: "Follow up with the candidate to confirm payment status. Collect a screenshot of the payment confirmation or verify the payment directly through the AHPRA portal.\n\n\u2014 Actor: Candidate \u00b7 Template: Payment Follow-up Template \u00b7 Target: 1 to 7 days" },
  { seq: 10, phase: "AHPRA Account & Application", name: "Complete orientation", isRequired: true, slaDays: 1, description: "Log in to the AHPRA portal using the candidate's credentials and complete the orientation module. Update DESMA Connect once completed.\n\n\u2014 Actor: Internal \u00b7 Template: Orientation Completion Template \u00b7 Target: 24 Hours \u00b7 Proof required" },
  { seq: 11, phase: "AHPRA Account & Application", name: "Send documents for attestation", isRequired: true, slaDays: 7, description: "Send the required documents for attestation and record the dispatch details in DESMA Connect. Follow up until the attested documents are received.\n\n\u2014 Actor: External \u00b7 Template: Document Attestation Request Template \u00b7 Target: 1 to 7 days \u00b7 Proof required" },
  { seq: 12, phase: "AHPRA Account & Application", name: "Collect and review attested documents", isRequired: true, slaDays: 1, description: "After receiving the attested documents, review each document carefully for accuracy and completeness before proceeding.\n\n\u2014 Actor: Internal \u00b7 Template: Attested Document Review Checklist \u00b7 Target: 24 Hours" },
  { seq: 13, phase: "AHPRA Account & Application", name: "Complete portfolio", isRequired: true, slaDays: 2, description: "Complete the portfolio section in the AHPRA portal, upload the required documents, submit the application, and inform the candidate to await the Decision Letter.\n\n\u2014 Actor: Internal \u00b7 Template: Portfolio Completion and DL Waiting Message Template \u00b7 Target: 2 Days" },
  { seq: 14, phase: "AHPRA Account & Application", name: "Await AHPRA Decision Letter", isRequired: true, slaDays: 180, description: "Send an email to the candidate informing them that the application has been submitted and that they should wait for the Decision Letter from AHPRA.\n\n\u2014 Actor: External \u00b7 Template: Decision Letter Waiting Follow-up Template \u00b7 Target: 1-6 months" },
  { seq: 15, phase: "Decision Letter & PEARSONVUE", name: "Handle additional document requests", isRequired: false, slaDays: 7, description: "If a case manager assigned by AHPRA requests additional documents or information, promptly inform the candidate and coordinate submission.\n\n\u2014 Actor: Internal \u00b7 Template: Additional Document Follow-up Template \u00b7 Target: 1 to 7 days \u00b7 Conditional (from step 14)" },
  { seq: 16, phase: "Decision Letter & PEARSONVUE", name: "Conduct daily Decision Letter status check", isRequired: true, slaDays: 0, description: "Check the AHPRA portal and the candidate's email inbox daily to monitor the status of the Decision Letter. Log any updates in DESMA Connect.\n\n\u2014 Actor: Internal \u00b7 Template: Decision Letter Follow-up Template \u00b7 Target: Daily" },
  { seq: 17, phase: "Decision Letter & PEARSONVUE", name: "Communicate Decision Letter to candidate and Provide ATT timing guidance", isRequired: true, slaDays: 1, description: "Once the Decision Letter is received, send it to the candidate via email along with the visiting visa fund requirements needed for the next stage.\n\n\u2014 Actor: Internal \u00b7 Template: Congratulations / DL Email Template \u00b7 Target: 24 Hours \u00b7 Proof required" },
  { seq: 18, phase: "Decision Letter & PEARSONVUE", name: "Receive Google review", isRequired: true, slaDays: 7, description: "After the candidate receives the Decision Letter, ask them to leave a Google review if they have not already done so. Use the standard follow-up message template.\n\n\u2014 Actor: Candidate \u00b7 Template: Google Review Request Template (Post-DL) \u00b7 Target: 1 to 7 days" },
  { seq: 19, phase: "Decision Letter & PEARSONVUE", name: "Create Pearson VUE account", isRequired: true, slaDays: 7, description: "Create a Pearson VUE account for the candidate. If the candidate does not have an active Indian phone number, request one before proceeding. Update DESMA Connect once the account is created.\n\n\u2014 Actor: Internal \u00b7 Template: Pearson VUE Account Creation Template \u00b7 Target: 1 to 7 days \u00b7 Proof required" },
  { seq: 20, phase: "ATT & NCLEX Exam", name: "Apply for ATT", isRequired: true, slaDays: 180, description: "Share the Pearson VUE user ID, password, and detailed ATT application steps with the candidate. Complete or assist with the ATT application and update DESMA Connect with the ATT application status.\n\n\u2014 Actor: Candidate \u00b7 Template: ATT Application Guidance Template \u00b7 Target: 1-6 months" },
  { seq: 21, phase: "ATT & NCLEX Exam", name: "Resolve IQNM phone number mismatch", isRequired: false, slaDays: 1, description: "If IQNM raises a query due to a mismatch between the phone number provided to Pearson VUE and the number in AHPRA records, send a reply email to IQNM stating the candidate's current mobile number.\n\n\u2014 Actor: Internal \u00b7 Template: IQNM Phone Number Mismatch Email Template \u00b7 Target: 24 Hours \u00b7 Conditional (from step 20)" },
  { seq: 22, phase: "ATT & NCLEX Exam", name: "Receive ATT from Pearson VUE", isRequired: true, slaDays: 30, description: "Monitor the candidate's email regularly. Once the ATT is received, notify the candidate promptly and save the ATT screenshot in DESMA Connect.\n\n\u2014 Actor: External \u00b7 Template: ATT Screenshot Template \u00b7 Target: 30 days \u00b7 Proof required" },
  { seq: 23, phase: "ATT & NCLEX Exam", name: "Discuss exam date preference", isRequired: true, slaDays: 7, description: "Ask the candidate which month they plan to attend the NCLEX-RN exam and which exam centre they prefer. Share the list of available dates for their chosen centre and month.\n\n\u2014 Actor: Candidate \u00b7 Template: Exam Booking Planning Template \u00b7 Target: 7 days" },
  { seq: 24, phase: "ATT & NCLEX Exam", name: "Book NCLEX exam", isRequired: true, slaDays: 1, description: "Book the NCLEX-RN exam using the ATT. Collect the candidate's card details or guide them through self-payment. Confirm the exam date with the candidate and save booking screenshots in DESMA Connect.\n\n\u2014 Actor: Internal \u00b7 Template: Exam Booking Details Template \u00b7 Target: 24 Hours \u00b7 Proof required" },
  { seq: 25, phase: "ATT & NCLEX Exam", name: "Provide exam day briefing", isRequired: true, slaDays: 1, description: "Inform the candidate of everything they need to bring to the exam, including the printed appointment confirmation email and original passport. Update DESMA Connect to confirm the briefing is completed.\n\n\u2014 Actor: Internal \u00b7 Template: Required Documents for NCLEX-RN Examination Template \u00b7 Target: 24 Hours" },
  { seq: 26, phase: "NCLEX Result & OSCE", name: "Communicate NCLEX result", isRequired: true, slaDays: 7, description: "Monitor the candidate's email regularly after the exam. Once the result is received, formally communicate it to the candidate. If passed, include information on English language test requirements needed for final AHPRA registration.\n\n\u2014 Actor: Internal \u00b7 Template: NCLEX Result Email Template (Pass / Fail) \u00b7 Target: 1 week \u00b7 Proof required" },
  { seq: 27, phase: "NCLEX Result & OSCE", name: "If unsuccessful, plan NCLEX re-attempt", isRequired: false, slaDays: 45, description: "If the candidate has not passed the NCLEX-RN exam, share the result sensitively and ask when they plan to attempt the exam again. Note the planned date in DESMA Connect.\n\n\u2014 Actor: Candidate \u00b7 Template: NCLEX Result Email Template (Pass / Fail) \u00b7 Target: 45 Days \u00b7 Conditional (from step 26)" },
  { seq: 28, phase: "NCLEX Result & OSCE", name: "Refer to NAI for OSCE coaching", isRequired: true, slaDays: 1, description: "If the candidate has passed the NCLEX-RN exam, send the candidate's full details to Anusha for OSCE coaching under NAI.\n\n\u2014 Actor: Internal \u00b7 Template: Details to Anusha Template \u00b7 Target: 24 Hours" },
  { seq: 29, phase: "NCLEX Result & OSCE", name: "Follow up for Google review", isRequired: true, slaDays: 7, description: "Once the candidate passes the NCLEX-RN exam, ask them to leave a Google review if they have not already done so. Follow up until the review is completed.\n\n\u2014 Actor: Internal \u00b7 Template: Google Review Request Template (Post-NCLEX) \u00b7 Target: 1 to 7 days" },
  { seq: 30, phase: "NCLEX Result & OSCE", name: "Discuss show money", isRequired: true, slaDays: 1, description: "Discuss show money requirements with the candidate by phone or message and record the agreed plan in DESMA Connect.\n\n\u2014 Actor: Internal \u00b7 Template: Show Money Clarification Template \u00b7 Target: 24 Hours" },
  { seq: 31, phase: "Visiting Visa Process", name: "Confirm OSCE fee payment", isRequired: true, slaDays: 180, description: "Inform the candidate to pay the OSCE fee to receive the eligibility letter. Once the eligibility letter is received, transfer all relevant candidate details to the visa processing team.\n\n\u2014 Actor: Candidate \u00b7 Template: OSCE Fee Payment Steps Template \u00b7 Target: 1-6 months \u00b7 Proof required" },
  { seq: 32, phase: "Visiting Visa Process", name: "Send visa agreement and checklist", isRequired: true, slaDays: 1, description: "Send the visa agreement and document checklist to the candidate and explain the required documents for the visitor visa application.\n\n\u2014 Actor: Internal \u00b7 Template: Visa Document Checklist, Visa Agreement \u00b7 Target: 24 Hours" },
  { seq: 33, phase: "Visiting Visa Process", name: "Receive signed visa agreement and required documents", isRequired: true, slaDays: 7, description: "Receive the signed visa agreement and required documents from the candidate. Check whether any documents are missing and follow up if required.\n\n\u2014 Actor: Candidate \u00b7 Template: Visa Document Follow-up Template \u00b7 Target: 1 to 7 days" },
  { seq: 34, phase: "Visiting Visa Process", name: "Visa documentation", isRequired: true, slaDays: 7, description: "Prepare the visa documentation, including supporting statements, financial documents, travel details, and OSCE-related evidence.\n\n\u2014 Actor: Internal \u00b7 Template: Visa Documentation Template \u00b7 Target: 1 to 7 days" },
  { seq: 35, phase: "Visiting Visa Process", name: "Receive visa service charge and application fee", isRequired: true, slaDays: 1, description: "Collect the visa service charge and visa application fee from the candidate and record the payment details.\n\n\u2014 Actor: Candidate \u00b7 Template: Payment Collection Template \u00b7 Target: 24 Hours" },
  { seq: 36, phase: "Visiting Visa Process", name: "Submit visa application", isRequired: true, slaDays: 1, description: "Submit the visitor visa application after confirming that all required documents and payments have been received.\n\n\u2014 Actor: Internal \u00b7 Template: Visa Submission Template \u00b7 Target: 24 Hours" },
  { seq: 37, phase: "Visiting Visa Process", name: "Await visa outcome and monitor emails daily", isRequired: true, slaDays: 45, description: "Monitor the candidate's email and visa portal daily until the visa outcome is received.\n\n\u2014 Actor: External \u00b7 Template: Visa Follow-up Email Template \u00b7 Target: 30-45 Days" },
  { seq: 38, phase: "Visiting Visa Process", name: "Communicate visa outcome to candidate", isRequired: true, slaDays: 1, description: "Once the candidate's visa is granted, send the visa copy and payment slip to AHPRA to initiate the OSCE date allocation process. Inform the candidate of the outcome.\n\n\u2014 Actor: Internal \u00b7 Template: Visa Outcome Template \u00b7 Target: 24 Hours \u00b7 Proof required" },
  { seq: 39, phase: "OSCE Coaching", name: "Provide OSCE coaching enrolment guidance", isRequired: true, slaDays: 1, description: "Guide the candidate on OSCE coaching enrolment and payment completion. Share the enrolment form and confirm completion.\n\n\u2014 Actor: Internal \u00b7 Template: OSCE Coaching Enrolment and Payment Template \u00b7 Target: 24 Hours" },
  { seq: 40, phase: "OSCE Scheduling", name: "Submit visa details to AHPRA and await OSCE slot confirmation", isRequired: true, slaDays: 1, description: "Submit the visa details and required proof to AHPRA and wait for OSCE slot confirmation.\n\n\u2014 Actor: External \u00b7 Template: Email to AHPRA Template \u00b7 Target: 24 Hours" },
  { seq: 41, phase: "OSCE Scheduling", name: "Communicate AHPRA slot details to candidate", isRequired: true, slaDays: 14, description: "After 2 to 3 weeks, AHPRA will send an email with available OSCE slots and a Google Sheet. Discuss the slot options with the candidate and complete the form based on their decision.\n\n\u2014 Actor: Internal \u00b7 Template: OSCE Slot Communication Template \u00b7 Target: 7 to 14 days" },
  { seq: 42, phase: "OSCE Scheduling", name: "Arrange next slot, if candidate is not ready", isRequired: false, slaDays: 30, description: "If the candidate is not ready to take the first available slot, wait for the next slot from AHPRA. Once a new slot is provided, inform the candidate promptly and confirm their decision.\n\n\u2014 Actor: External \u00b7 Template: Next Slot Waiting Template \u00b7 Target: 30 days \u00b7 Conditional (from step 41)" },
  { seq: 43, phase: "OSCE Scheduling", name: "Receive OSCE date confirmation from AHPRA", isRequired: true, slaDays: 30, description: "Once the candidate accepts an OSCE slot, AHPRA will confirm the date and send consent forms. Share these forms with the candidate and ask them to print, sign, and return them. Ensure they review the OSCE confirmation letter and handbook.\n\n\u2014 Actor: External \u00b7 Template: OSCE Forms Template \u00b7 Target: 30 days \u00b7 Proof required" },
  { seq: 44, phase: "OSCE Scheduling", name: "Assist with flight ticket booking and confirmation", isRequired: true, slaDays: 1, description: "After OSCE date confirmation is received in the candidate's email, discuss flight ticket options, rates, and confirmation with the candidate. Send a WhatsApp message confirming the exam date and travel plan.\n\n\u2014 Actor: Internal \u00b7 Template: Flight Ticket Discussion and Confirmation Template \u00b7 Target: 24 Hours" },
  { seq: 45, phase: "OSCE Scheduling", name: "Regularly follow up on preparation and travel", isRequired: true, slaDays: 0, description: "Follow up with the candidate regularly regarding OSCE preparation, travel planning, accommodation, and required documents.\n\n\u2014 Actor: Internal \u00b7 Template: Regular Follow-up Visa Message Template \u00b7 Target: Weekly" },
  { seq: 46, phase: "OSCE Result", name: "Monitor OSCE result email", isRequired: true, slaDays: 0, description: "Monitor the candidate's email for the OSCE result and update DESMA Connect when the result is received.\n\n\u2014 Actor: Internal \u00b7 Template: OSCE Result Follow-up Template \u00b7 Target: Daily" },
  { seq: 47, phase: "OSCE Result", name: "Communicate OSCE result", isRequired: true, slaDays: 0, description: "Communicate the OSCE result to the candidate by email and WhatsApp. If passed, explain the final registration steps. If unsuccessful, explain the next available options.\n\n\u2014 Actor: Internal \u00b7 Template: OSCE Result Communication Template \u00b7 Target: 2 Hours" },
  { seq: 48, phase: "Final Registration", name: "Submit language test results", isRequired: true, slaDays: 90, description: "Verify that the candidate has achieved the required English language test score. This must be confirmed before proceeding with the final registration process.\n\n\u2014 Actor: Candidate \u00b7 Template: Language Test Submission Template \u00b7 Target: 1 to 3 months \u00b7 Proof required" },
  { seq: 49, phase: "Final Registration", name: "Receive and verify language test results", isRequired: true, slaDays: 1, description: "Receive the language test result, verify the scores against AHPRA requirements, and save the evidence in DESMA Connect.\n\n\u2014 Actor: Internal \u00b7 Template: Language Score Verification Template \u00b7 Target: 24 Hours" },
  { seq: 50, phase: "Final Registration", name: "Receive final registration service charge", isRequired: true, slaDays: 7, description: "Collect the final registration service charge from the candidate and record the payment details.\n\n\u2014 Actor: Candidate \u00b7 Template: Payment Collection Template \u00b7 Target: 1 to 7 days" },
  { seq: 51, phase: "Final Registration", name: "Send final paperwork checklist", isRequired: true, slaDays: 1, description: "Send the candidate the complete checklist of documents required for the final AHPRA registration application.\n\n\u2014 Actor: Internal \u00b7 Template: Final Paperwork Checklist and Email Template \u00b7 Target: 24 Hours" },
  { seq: 52, phase: "Final Registration", name: "Complete international criminal history check", isRequired: true, slaDays: 3, description: "Once the language score is cleared, complete the international criminal history check for the candidate as required by AHPRA for final registration.\n\n\u2014 Actor: Internal \u00b7 Template: International Criminal History Check Template \u00b7 Target: 1-3 Days \u00b7 Proof required" },
  { seq: 53, phase: "Final Registration", name: "Process final registration application fee payment", isRequired: true, slaDays: 3, description: "Fill in all required details in the AHPRA portal, upload the necessary documents, and complete the final registration fee payment on behalf of the candidate.\n\n\u2014 Actor: Candidate \u00b7 Template: Final Application and Fee Payment Template \u00b7 Target: 1-3 Days \u00b7 Proof required \u00b7 Approval required" },
  { seq: 54, phase: "Final Registration", name: "Complete council verification", isRequired: true, slaDays: 45, description: "Assist the candidate through the council verification process. Follow up regularly to ensure completion without delays.\n\n\u2014 Actor: Internal \u00b7 Template: Council Verification Follow-up Template \u00b7 Target: 30-45 days" },
  { seq: 55, phase: "Final Registration", name: "Follow up on emails", isRequired: true, slaDays: 0, description: "Monitor emails regularly and respond to any final registration-related queries from AHPRA or other authorities.\n\n\u2014 Actor: Internal \u00b7 Template: Email Follow-up Template \u00b7 Target: Daily" },
  { seq: 56, phase: "Final Registration", name: "Receive AHPRA registration confirmation", isRequired: true, slaDays: 90, description: "Monitor the candidate's email for the final AHPRA registration confirmation. Notify the candidate as soon as the confirmation email is received.\n\n\u2014 Actor: External \u00b7 Template: AHPRA Registration Confirmation Template \u00b7 Target: 1-3 Months \u00b7 Proof required" },
  { seq: 57, phase: "Final Registration", name: "Share certificate and login credentials", isRequired: true, slaDays: 1, description: "Send the AHPRA registration certificate and login credentials to the candidate via email.\n\n\u2014 Actor: Internal \u00b7 Template: Certificate Communication Email Template \u00b7 Target: 24 Hours \u00b7 Proof required" },
  { seq: 58, phase: "Final Registration", name: "Request testimonial and Google review", isRequired: true, slaDays: 1, description: "Request a video testimonial and a recent photo from the candidate. Also ask for an updated Google review if not already provided. Follow up until all are received.\n\n\u2014 Actor: Candidate \u00b7 Template: Follow-up Template \u00b7 Target: 24 Hours" },
];

async function main() {
  const service = await prisma.service.findUnique({
    where: { name: SERVICE_NAME },
    select: { id: true },
  });
  if (!service) {
    console.error(
      `Service "${SERVICE_NAME}" not found. Run \`npm run db:migrate-services\` first, then re-run this seed.`,
    );
    process.exit(1);
  }

  const existing = await prisma.processTemplate.findFirst({
    where: { serviceId: service.id, name: TEMPLATE_NAME },
    select: { id: true, version: true },
  });

  if (DRY) {
    const phases = [...new Set(STEPS.map((s) => s.phase))];
    console.log(`[dry-run] service "${SERVICE_NAME}" found (id ${service.id}).`);
    console.log(
      existing
        ? `[dry-run] template "${TEMPLATE_NAME}" exists (v${existing.version}) -> would UPDATE + upsert ${STEPS.length} steps.`
        : `[dry-run] no existing template -> would CREATE "${TEMPLATE_NAME}" + ${STEPS.length} steps.`,
    );
    console.log(`[dry-run] ${STEPS.length} steps across ${phases.length} phases; per-step turnarounds sum to ~${STEPS.reduce((a, s) => a + (s.slaDays ?? 0), 0)} working days (provisional).`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    let templateId: string;
    if (existing) {
      await tx.processTemplate.update({
        where: { id: existing.id },
        data: { description: TEMPLATE_DESCRIPTION, isActive: true, isSystem: true },
      });
      templateId = existing.id;
    } else {
      const agg = await tx.processTemplate.aggregate({
        where: { serviceId: service.id },
        _max: { version: true },
      });
      const version = (agg._max.version ?? 0) + 1;
      const created = await tx.processTemplate.create({
        data: {
          serviceId: service.id,
          name: TEMPLATE_NAME,
          description: TEMPLATE_DESCRIPTION,
          isActive: true,
          isSystem: true,
          version,
        },
        select: { id: true },
      });
      templateId = created.id;
    }

    // Keep this the sole active template for the service (invariant enforced in app code).
    await tx.processTemplate.updateMany({
      where: { serviceId: service.id, id: { not: templateId }, isActive: true },
      data: { isActive: false },
    });

    for (const s of STEPS) {
      await tx.processTemplateStep.upsert({
        where: { templateId_seq: { templateId, seq: s.seq } },
        create: {
          templateId,
          seq: s.seq,
          name: s.name,
          description: s.description,
          phase: s.phase,
          isRequired: s.isRequired,
          slaDays: s.slaDays,
        },
        update: {
          name: s.name,
          description: s.description,
          phase: s.phase,
          isRequired: s.isRequired,
          slaDays: s.slaDays,
        },
      });
    }

    // Drop any leftover steps beyond our set (shrink safety on re-run).
    await tx.processTemplateStep.deleteMany({
      where: { templateId, seq: { gt: STEPS.length } },
    });
  });

  console.log(`OK: seeded "${TEMPLATE_NAME}" (${STEPS.length} steps) for service "${SERVICE_NAME}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
