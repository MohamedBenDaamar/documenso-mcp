import { describe, expect, it } from "vitest";

import { maskEmail, maskEmailsIn } from "../src/documenso/envelopes.js";

describe("maskEmail", () => {
  it("keeps the first two characters and the domain", () => {
    expect(maskEmail("jordan.lee@contoso.example")).toBe("jo***@contoso.example");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
  });

  it("hides values that are not email addresses", () => {
    expect(maskEmail("not-an-email")).toBe("***");
  });
});

describe("maskEmailsIn", () => {
  it("masks a name that is an email address", () => {
    expect(maskEmailsIn("jordan.lee@contoso.example")).toBe("jo***@contoso.example");
  });

  it("masks email addresses inside a longer name", () => {
    expect(maskEmailsIn("Jordan Lee <jordan.lee@contoso.example>")).toBe("Jordan Lee <jo***@contoso.example>");
    expect(maskEmailsIn("a@x.io, b.c@y.org")).toBe("a***@x.io, b.***@y.org");
  });

  it("leaves ordinary names alone", () => {
    for (const name of ["Jordan Lee", "Sam O'Neil", "Acme Legal (signer 1)", "", "user at example dot com"]) {
      expect(maskEmailsIn(name)).toBe(name);
    }
  });
});
