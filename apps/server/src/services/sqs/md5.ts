import { createHash } from "node:crypto";

export interface MessageAttributeValue {
  DataType: string;
  StringValue?: string;
  /** Base64-encoded bytes. */
  BinaryValue?: string;
}

export const md5Hex = (data: string | Buffer) => createHash("md5").update(data).digest("hex");

/**
 * MD5OfMessageAttributes, computed exactly as SQS does so SDK checksum validation would pass:
 * for each attribute sorted by name, encode name, data type, a transport byte (1 = string,
 * 2 = binary) and the value, each length-prefixed with a 4-byte big-endian length.
 */
export function md5OfMessageAttributes(attributes: Record<string, MessageAttributeValue>): string {
  const parts: Buffer[] = [];
  const lengthPrefixed = (buf: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(buf.length);
    parts.push(len, buf);
  };
  for (const name of Object.keys(attributes).sort()) {
    const attr = attributes[name] as MessageAttributeValue;
    lengthPrefixed(Buffer.from(name, "utf8"));
    lengthPrefixed(Buffer.from(attr.DataType, "utf8"));
    if (attr.BinaryValue !== undefined) {
      parts.push(Buffer.from([2]));
      lengthPrefixed(Buffer.from(attr.BinaryValue, "base64"));
    } else {
      parts.push(Buffer.from([1]));
      lengthPrefixed(Buffer.from(attr.StringValue ?? "", "utf8"));
    }
  }
  return md5Hex(Buffer.concat(parts));
}
