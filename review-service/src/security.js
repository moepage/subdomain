const encoder = new TextEncoder();
async function key(secret) {
  if (!secret || secret.length < 32)
    throw new Error("Missing or weak signing secret.");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
const hex = (buffer) =>
  Array.from(new Uint8Array(buffer), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
export async function sign(secret, value) {
  return hex(
    await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(value)),
  );
}
export async function verify(secret, value, signature) {
  if (!/^[a-f\d]{64}$/.test(signature ?? "")) return false;
  return crypto.subtle.verify(
    "HMAC",
    await key(secret),
    Uint8Array.from(signature.match(/../g), (byte) => parseInt(byte, 16)),
    encoder.encode(value),
  );
}
export async function tokenFor(row, secret) {
  const value = `${row.id}.${row.expires}`;
  return `${value}.${await sign(secret, value)}`;
}
export async function parseToken(
  token,
  secret,
  now = Math.floor(Date.now() / 1000),
) {
  if (typeof token !== "string" || token.length > 200) return null;
  const [id, expiry, signature, extra] = token.split(".");
  if (
    extra !== undefined ||
    !/^[a-f\d-]{36}$/.test(id ?? "") ||
    !/^\d{10}$/.test(expiry ?? "") ||
    Number(expiry) <= now
  )
    return null;
  if (!(await verify(secret, `${id}.${expiry}`, signature))) return null;
  return { id, expires: Number(expiry) };
}
export async function boundedText(request, maximum) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximum) {
      await reader.cancel();
      throw new Error("Request too large.");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}
