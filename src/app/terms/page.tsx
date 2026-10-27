import type { Metadata } from "next";
import Link from "next/link";
// Same look as the privacy policy: the two pages are read together.
import styles from "../privacy-policy/page.module.css";

export const metadata: Metadata = {
  title: "Terms and Conditions — Desgro | DESMA International Private Limited",
  description:
    "Terms for contacting DESMA International Private Limited on WhatsApp and for applying for a job through its careers site.",
};

export default function TermsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <h1 className={styles.h1}>Terms and Conditions</h1>
          <p className={styles.dates}>Effective date: 27 October 2026 · Last updated: 27 October 2026</p>
        </header>

        <h2 id="about" className={styles.h2}>1. About these terms</h2>
        <p>
          These terms are set by <strong>DESMA International Private Limited</strong> (“DESMA International”,
          “we”, “us”, “our”). They apply when you:
        </p>
        <ul>
          <li>message us on WhatsApp, or give us your WhatsApp number in an enquiry, a lead form or a conversation with our team;</li>
          <li>apply for a job with us through our careers site, or a recruitment partner sends us your application; or</li>
          <li>open a link we send you, such as an offer letter, an agreement to sign or a shared document.</li>
        </ul>
        <p>
          By doing any of these you accept these terms. Please read them together with our{" "}
          <Link href="/privacy-policy">Privacy Policy</Link>, which explains in detail what personal data we collect,
          how long we keep it and how to ask us to delete it.
        </p>
        <p className={styles.idblock}>
          <strong>Registered address:</strong> XVI 195/C, First Floor, Keltron Road, Aroor, Kerala 688534, India
          <br />
          <strong>CIN:</strong> U70200KL2023PTC084811
          <br />
          <strong>GSTIN:</strong> 32AAKCD4674Q1Z1
          <br />
          <strong>Contact:</strong> <a href="mailto:hello@desma.in">hello@desma.in</a>
        </p>

        <h2 id="services" className={styles.h2}>2. Our services</h2>
        <p>
          DESMA International is a nursing migration and registration consultancy. We help nurses in India register
          and build careers abroad, including registration with bodies such as AHPRA, the NMC and CGFNS.
        </p>
        <ul>
          <li>
            Information we share over WhatsApp, by email or on a call is general guidance. It is not legal or
            immigration advice, and requirements set by regulators, employers and governments can change without
            notice.
          </li>
          <li>
            Registration, licensing, visa and employment decisions are made by the relevant regulator, authority or
            employer, not by us. We do not guarantee any outcome.
          </li>
          <li>
            Any paid service is governed by the written agreement you sign with us for that service. If that
            agreement and these terms disagree, the agreement applies.
          </li>
        </ul>

        <h2 id="whatsapp" className={styles.h2}>3. WhatsApp messages and your consent</h2>

        <h3 className={styles.h3}>3.1 How you agree to hear from us</h3>
        <p>
          You consent to receive WhatsApp messages from us about your enquiry and the services you asked about when
          you:
        </p>
        <ul>
          <li>send a message to one of our WhatsApp business numbers;</li>
          <li>enter your WhatsApp number in one of our lead forms, including forms on Facebook and Instagram ads and on our websites; or</li>
          <li>give your number to a member of our team and ask us to contact you on WhatsApp.</li>
        </ul>
        <p>
          Give us only a number that is yours, or one you have permission to share, and tell us if it changes. If you
          give us someone else&rsquo;s number, you are responsible for having their permission.
        </p>

        <h3 className={styles.h3}>3.2 What we send</h3>
        <ul>
          <li>
            <strong>Service messages:</strong> replies to your questions, updates on your enquiry or application,
            reminders about documents, tasks and appointments, and notices about agreements you have been asked to
            sign.
          </li>
          <li>
            <strong>Marketing messages:</strong> information about courses, intakes, events and offers. We send these
            only to people who have contacted us or given us their number.
          </li>
        </ul>

        <h3 className={styles.h3}>3.3 How often and when</h3>
        <ul>
          <li>We send you no more than <strong>one marketing message a day</strong> and <strong>three in any seven days</strong>.</li>
          <li>
            Scheduled and automated messages go out between <strong>9 am and 8 pm in your local time</strong>, which
            we work out from your number&rsquo;s country code. For Indian numbers, marketing messages go out between
            10 am and 7:30 pm IST.
          </li>
          <li>
            A message you are waiting for, such as a one-time code or a reply to your own question, may arrive outside
            those hours.
          </li>
        </ul>

        <h3 className={styles.h3}>3.4 How to stop messages</h3>
        <div className={styles.note}>
          <p>
            Reply <strong>STOP</strong> (or “unsubscribe”, “opt out” or “remove me”) on its own, or tap{" "}
            <strong>Stop promotions</strong> under any of our marketing messages.
          </p>
        </div>
        <ul>
          <li>
            Once we receive it, we stop sending automated WhatsApp messages to that number, both marketing and
            automated reminders. This covers every record we hold with that number.
          </li>
          <li>
            The word must be sent on its own. A sentence like “stop sending me the wrong details” is treated as a
            message for our team, who will reply to it.
          </li>
          <li>If you message us after opting out, a member of our team may still reply to you personally.</li>
          <li>
            Opting out stops messages but does not delete your data. To have your data deleted, follow the steps in
            Section 9 of our <Link href="/privacy-policy#data-deletion">Privacy Policy</Link>.
          </li>
        </ul>

        <h3 className={styles.h3}>3.5 What you send us</h3>
        <ul>
          <li>
            Messages, documents, certificates, photos and voice notes you send us are stored with your record so that
            anyone on our team helping you can see them. Do not send anything you do not want us to keep.
          </li>
          <li>
            Do not send unlawful, abusive or misleading content, or another person&rsquo;s personal data without their
            permission.
          </li>
          <li>
            Our team reads WhatsApp during working hours, and the inbox is not watched around the clock. For anything
            urgent, email <a href="mailto:hello@desma.in">hello@desma.in</a>.
          </li>
        </ul>

        <h3 className={styles.h3}>3.6 WhatsApp itself</h3>
        <p>
          WhatsApp is run by Meta. Your use of it is governed by the{" "}
          <a href="https://www.whatsapp.com/legal/terms-of-service">WhatsApp Terms of Service</a>, and your mobile
          operator&rsquo;s data charges apply. We are not responsible for delays, outages or lost messages caused by
          WhatsApp, Meta or your network.
        </p>

        <h2 id="applicants" className={styles.h2}>4. Job applicants</h2>
        <p>
          This section applies if you apply for a role at DESMA International through{" "}
          <Link href="/careers/desma">our careers site</Link>, or a recruitment partner sends us your application.
        </p>

        <h3 className={styles.h3}>4.1 What we collect</h3>
        <ul>
          <li>Your name, email address and phone (WhatsApp) number</li>
          <li>Where you are now, your current role, your notice period and your expected salary</li>
          <li>Your résumé, portfolio and LinkedIn links, and any files the role asks for</li>
          <li>Your answers to the screening questions for the role</li>
          <li>Notes and feedback our hiring team records during interviews</li>
        </ul>

        <h3 className={styles.h3}>4.2 How we use it</h3>
        <ul>
          <li>To assess you for the role you applied for and for similar roles with us</li>
          <li>
            To contact you about your application and interviews by email or phone. We send you automated WhatsApp
            updates about your application only if you have agreed to receive them.
          </li>
          <li>
            To share with the people involved in the hiring decision and, if a recruitment partner sent us your
            application, with that partner, but only about your application
          </li>
        </ul>
        <p>We do not sell applicant data or share it with other employers.</p>

        <h3 className={styles.h3}>4.3 How long we keep it</h3>
        <p>
          We keep an application for <strong>24 months</strong> from the date we receive it. You can ask us to delete
          yours at any time by writing to <a href="mailto:hr@desma.in">hr@desma.in</a>. If you join us, your
          application becomes part of your employee record, which your employment terms govern.
        </p>

        <h3 className={styles.h3}>4.4 Your responsibilities</h3>
        <ul>
          <li>
            Everything you tell us must be true and your own. If we find that an application contained false
            information, we may reject it, withdraw an offer, or end your employment if you have already joined.
          </li>
          <li>
            If a recruitment partner applies on your behalf, the partner must have your permission to share your
            details with us.
          </li>
        </ul>

        <h3 className={styles.h3}>4.5 Applications and offers</h3>
        <ul>
          <li>Applying does not guarantee an interview or an offer. We may change, pause or close a role at any time.</li>
          <li>
            An offer is binding only once it has been made in a written offer letter and accepted, including through
            our online signing page.
          </li>
          <li>
            <strong>DESMA International never charges job applicants a fee.</strong> If anyone asks you for money in
            our name to get a job with us, do not pay, and report it to{" "}
            <a href="mailto:hr@desma.in">hr@desma.in</a>.
          </li>
        </ul>

        <h2 id="links" className={styles.h2}>5. Links we send you</h2>
        <p>
          Some links we send, such as an offer letter, an agreement to sign or a shared document, are personal to you.
          Do not forward them. They may expire or be withdrawn, and any one-time code that comes with them is for you
          alone. If you receive one of these links by mistake, tell us and do not use it.
        </p>

        <h2 id="liability" className={styles.h2}>6. Limitation of liability</h2>
        <p>To the extent the law allows, we are not liable for:</p>
        <ul>
          <li>decisions made by regulators, authorities, employers or examination bodies;</li>
          <li>loss caused by relying on general guidance shared over WhatsApp or other informal channels; or</li>
          <li>delays or failures caused by WhatsApp, Meta, your network or other events outside our reasonable control.</li>
        </ul>
        <p>Nothing in these terms limits any liability that cannot be limited under applicable law.</p>

        <h2 id="changes" className={styles.h2}>7. Changes to these terms</h2>
        <p>
          We may update these terms from time to time. When we do, we will revise the “Last updated” date at the top of
          this page. The version on this page when you contact us or apply is the one that applies.
        </p>

        <h2 id="law" className={styles.h2}>8. Governing law</h2>
        <p>
          These terms are governed by the laws of India. Any dispute arising from them is subject to the exclusive
          jurisdiction of the courts in Kerala, India.
        </p>

        <h2 id="contact" className={styles.h2}>9. Contact us</h2>
        <p>
          Questions about these terms:
          <br />
          <br />
          <strong>DESMA International Private Limited</strong>
          <br />
          XVI 195/C, First Floor, Keltron Road, Aroor, Kerala 688534, India
          <br />
          General enquiries: <a href="mailto:hello@desma.in">hello@desma.in</a>
          <br />
          Job applications: <a href="mailto:hr@desma.in">hr@desma.in</a>
        </p>

        <footer className={styles.footer}>
          These terms apply to DESMA International&rsquo;s WhatsApp channels, its careers site and the services at
          desgro.in. See also our <Link href="/privacy-policy">Privacy Policy</Link>.
        </footer>
      </div>
    </div>
  );
}
