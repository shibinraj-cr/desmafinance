/** A code that isn't a referral link — mistyped, or cut short when it was copied. */
export default function ReferralNotFound() {
  return (
    <div className="mx-auto max-w-xl px-md py-xl space-y-sm">
      <h1 className="text-h1 careers-ink">This link doesn&apos;t work</h1>
      <p className="text-body-lg careers-muted">
        Please check that you copied the whole link, or ask the person who shared it to send it again. You can also
        write to us at{" "}
        <a className="underline" href="mailto:hello@desma.in">
          hello@desma.in
        </a>
        .
      </p>
    </div>
  );
}
