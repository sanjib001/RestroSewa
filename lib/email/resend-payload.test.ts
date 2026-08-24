import test from "node:test";
import assert from "node:assert/strict";
import {
  buildResendPayload,
  formatFrom,
  isRetryableStatus,
  parseResendError,
  toBase64,
} from "./resend-payload.ts";

const base = { to: ["a@b.com"], subject: "S", html: "<p>h</p>", text: "t" };

test("formatFrom pairs a display name with the address", () => {
  assert.equal(formatFrom("r@x.np", "HRestroSewa Reports"), '"HRestroSewa Reports" <r@x.np>');
});

test("formatFrom omits the name when there is not one", () => {
  assert.equal(formatFrom("r@x.np"), "r@x.np");
  assert.equal(formatFrom("r@x.np", "   "), "r@x.np");
  assert.equal(formatFrom("  r@x.np  ", null), "r@x.np");
});

test("a quote in the display name cannot break out of the header", () => {
  assert.equal(formatFrom("r@x.np", 'Ev"il'), '"Evil" <r@x.np>');
});

test("attachments are base64 encoded, whatever they arrive as", () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
  assert.equal(toBase64(bytes), "JVBERg==");
  assert.equal(toBase64(bytes.buffer), "JVBERg==");
  assert.equal(toBase64("%PDF"), "JVBERg==");
  assert.equal(toBase64(Buffer.from("%PDF")), "JVBERg==");
});

test("a PDF attachment survives the round trip byte for byte", () => {
  const pdf = new Uint8Array(256).map((_, i) => i); // every byte value
  const payload = buildResendPayload(
    { ...base, attachments: [{ filename: "r.pdf", content: pdf }] },
    "r@x.np"
  );
  const back = new Uint8Array(Buffer.from(payload.attachments![0].content, "base64"));
  assert.deepEqual(back, pdf);
});

test("the attachments key is omitted entirely when there are none", () => {
  // Resend rejects an empty array rather than reading it as "nothing attached".
  assert.equal("attachments" in buildResendPayload(base, "r@x.np"), false);
  assert.equal("attachments" in buildResendPayload({ ...base, attachments: [] }, "r@x.np"), false);
});

test("attachments default to application/pdf but honour an override", () => {
  const p = buildResendPayload(
    {
      ...base,
      attachments: [
        { filename: "a.pdf", content: "x" },
        { filename: "b.csv", content: "y", contentType: "text/csv" },
      ],
    },
    "r@x.np"
  );
  assert.equal(p.attachments![0].content_type, "application/pdf");
  assert.equal(p.attachments![1].content_type, "text/csv");
});

test("recipients are trimmed and blanks dropped", () => {
  const p = buildResendPayload({ ...base, to: [" a@b.com ", "", "   ", "c@d.com"] }, "r@x.np");
  assert.deepEqual(p.to, ["a@b.com", "c@d.com"]);
});

test("the payload carries both bodies, so no client is left without one", () => {
  const p = buildResendPayload(base, "r@x.np");
  assert.equal(p.html, "<p>h</p>");
  assert.equal(p.text, "t");
  assert.equal(p.subject, "S");
  assert.equal(p.from, "r@x.np");
});

test("a JSON error is reduced to its message", () => {
  assert.equal(
    parseResendError(403, '{"statusCode":403,"name":"validation_error","message":"Domain not verified"}'),
    "Resend 403: Domain not verified"
  );
});

test("a non-JSON error body still yields one readable line", () => {
  assert.equal(parseResendError(502, "<html>\n  <body>Bad Gateway</body>\n</html>"),
    "Resend 502: <html> <body>Bad Gateway</body> </html>");
  assert.equal(parseResendError(500, ""), "Resend 500");
  assert.equal(parseResendError(400, "{not json"), "Resend 400: {not json");
});

test("a long error body is truncated so it fits the deliveries column", () => {
  const msg = parseResendError(500, "x".repeat(1000));
  assert.ok(msg.length < 250, `error line was ${msg.length} chars`);
});

test("only transient statuses are retried", () => {
  // A bad key or unverified domain stays bad — retrying writes the same error 3×.
  for (const s of [400, 401, 403, 404, 422]) assert.equal(isRetryableStatus(s), false, `${s}`);
  for (const s of [429, 500, 502, 503]) assert.equal(isRetryableStatus(s), true, `${s}`);
});
