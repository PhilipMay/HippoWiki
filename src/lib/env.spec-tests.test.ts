// Tests written from the requirements of the attachment groundwork alone (`spec/attachment-groundwork-requirements.md`,
// R9), for the parts of the rule that the tests of the environment leave open: the value of the scenario and further
// values that are not a whole number or carry a unit.

import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env";

const databaseUrl = "postgresql://hippowiki:hippowiki@localhost:5432/hippowiki";

const VARIABLES = ["HIPPOWIKI_MCP_BODY_LIMIT", "HIPPOWIKI_MCP_RATE_BURST", "HIPPOWIKI_MCP_RATE_PER_MINUTE"] as const;

describe("the variables of the limits of MCP", () => {
  // attachment-groundwork-requirements.md, "Scenarios": an operator sets HIPPOWIKI_MCP_BODY_LIMIT to 4 MiB.
  it("accepts 4 MiB in bytes for HIPPOWIKI_MCP_BODY_LIMIT", () => {
    expect(parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_MCP_BODY_LIMIT: "4194304" })).toMatchObject({
      HIPPOWIKI_MCP_BODY_LIMIT: 4 * 1024 * 1024,
    });
  });

  // attachment-groundwork-requirements.md, R9: each variable is optional and has its default when it is not set,
  // whatever the other two are set to.
  it("keeps the defaults of the variables that are not set when one is set", () => {
    expect(parseServerEnv({ DATABASE_URL: databaseUrl, HIPPOWIKI_MCP_RATE_BURST: "10" })).toMatchObject({
      HIPPOWIKI_MCP_BODY_LIMIT: 1_048_576,
      HIPPOWIKI_MCP_RATE_BURST: 10,
      HIPPOWIKI_MCP_RATE_PER_MINUTE: 300,
    });
  });

  // attachment-groundwork-requirements.md, R9: a value that is not a whole number, or that has a unit, stops the
  // server with an error that names the variable.
  describe.each(VARIABLES)("%s", (name) => {
    it.each([
      "Infinity",
      "NaN",
      "-0",
      "0b11",
      "0o17",
      "1_000",
      "1,000",
      "1.",
      ".5",
      "\t60",
      "60\n",
      "１２",
      "4MiB",
      "4 MiB",
      "1M",
      "60/min",
      "true",
    ])("refuses %j with an error that names the variable", (value) => {
      expect(() => parseServerEnv({ DATABASE_URL: databaseUrl, [name]: value })).toThrow(new RegExp(name));
    });
  });
});
