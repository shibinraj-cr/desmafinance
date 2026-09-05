import { describe, it, expect } from "vitest";
import { parseCsv, guessMapping, mapRows, num } from "@/lib/hiring/csv-import";

describe("CSV parsing", () => {
  it("splits a plain file into headers and rows", () => {
    const { headers, rows } = parseCsv("Name,Email\nAnu,anu@example.com\nBala,bala@example.com");
    expect(headers).toEqual(["Name", "Email"]);
    expect(rows).toEqual([
      ["Anu", "anu@example.com"],
      ["Bala", "bala@example.com"],
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    const { rows } = parseCsv('Name,Role\n"Nair, Anu",BDE');
    expect(rows[0]).toEqual(["Nair, Anu", "BDE"]);
  });

  it("unescapes a doubled quote", () => {
    const { rows } = parseCsv('Name\n"She said ""hello"""');
    expect(rows[0]).toEqual(['She said "hello"']);
  });

  it("handles CRLF line endings", () => {
    const { rows } = parseCsv("Name\r\nAnu\r\nBala");
    expect(rows).toEqual([["Anu"], ["Bala"]]);
  });

  it("strips a UTF-8 BOM so the first header still matches", () => {
    const { headers } = parseCsv("﻿Name,Email\nAnu,a@b.com");
    expect(headers[0]).toBe("Name");
  });

  it("drops entirely blank lines", () => {
    const { rows } = parseCsv("Name\nAnu\n\n\nBala\n");
    expect(rows).toEqual([["Anu"], ["Bala"]]);
  });
});

describe("column mapping", () => {
  it("guesses the common header spellings", () => {
    const mapping = guessMapping(["Full Name", "E-Mail", "Mobile Number", "Current Company"]);
    expect(mapping).toEqual({ 0: "fullName", 1: "email", 2: "phone", 3: "currentEmployer" });
  });

  it("is case- and space-insensitive", () => {
    expect(guessMapping(["  NAME  "])[0]).toBe("fullName");
  });

  it("leaves an unrecognised header unmapped rather than guessing wrong", () => {
    expect(guessMapping(["Lead Score"])[0]).toBeNull();
  });

  it("never maps two columns onto the same field", () => {
    const mapping = guessMapping(["Name", "Candidate Name"]);
    expect(mapping[0]).toBe("fullName");
    expect(mapping[1]).toBeNull();
  });
});

describe("row mapping and the error report", () => {
  const mapping = { 0: "fullName", 1: "email", 2: "phone" } as const;

  it("normalises email and phone as it maps", () => {
    const { parsed } = mapRows([["Anu", " ANU@Example.COM ", "9847012345"]], { ...mapping });
    expect(parsed[0]).toMatchObject({
      fullName: "Anu",
      email: "anu@example.com",
      phone: "+919847012345",
    });
  });

  it("reports the row number a human can find in their spreadsheet", () => {
    // Row 1 is the header, so the first data row is row 2.
    const { problems } = mapRows([["", "a@b.com", ""]], { ...mapping });
    expect(problems[0]).toEqual({ rowNumber: 2, reason: "No name." });
  });

  it("refuses a row with no way to reach the person", () => {
    const { parsed, problems } = mapRows([["Anu", "", ""]], { ...mapping });
    expect(parsed).toHaveLength(0);
    expect(problems[0]!.reason).toContain("no way to reach them");
  });

  it("names the bad address rather than silently dropping the row", () => {
    const { problems } = mapRows([["Anu", "not-an-email", ""]], { ...mapping });
    expect(problems[0]!.reason).toContain("not-an-email");
  });

  it("catches a duplicate WITHIN the file, which a DB constraint would only find later", () => {
    const { parsed, problems } = mapRows(
      [
        ["Anu", "anu@example.com", ""],
        ["Anu again", "ANU@example.com", ""],
      ],
      { ...mapping },
    );
    expect(parsed).toHaveLength(1);
    expect(problems[0]).toMatchObject({ rowNumber: 3 });
    expect(problems[0]!.reason).toContain("appears earlier");
  });

  it("catches a duplicate phone within the file too", () => {
    const { problems } = mapRows(
      [
        ["Anu", "", "9847012345"],
        ["Bala", "", "+91 98470 12345"],
      ],
      { ...mapping },
    );
    expect(problems).toHaveLength(1);
  });

  it("ignores columns mapped to nothing", () => {
    const { parsed } = mapRows([["Anu", "a@b.com", "junk"]], { 0: "fullName", 1: "email", 2: null });
    expect(parsed[0]!.values.phone).toBeUndefined();
  });
});

describe("numeric coercion", () => {
  it("reads a number out of a messy cell", () => {
    expect(num("30 days")).toBe(30);
    expect(num("₹4.5")).toBe(4.5);
  });

  it("is null for nothing usable", () => {
    expect(num(undefined)).toBeNull();
    expect(num("")).toBeNull();
  });
});
