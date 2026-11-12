import { describe, expect, it } from "vitest";

import { parseLoginFormData, readPasswordChangeFormData } from "@/features/auth/forms";

function formData(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("parseLoginFormData", () => {
  it("returns the name and the password of a filled form", () => {
    expect(parseLoginFormData(formData({ name: "alice", password: "secret password" }))).toEqual({
      success: true,
      data: { name: "alice", password: "secret password" },
    });
  });

  it("passes on the password as it is, with its spaces", () => {
    expect(parseLoginFormData(formData({ name: "alice", password: "  spaced  " }))).toEqual({
      success: true,
      data: { name: "alice", password: "  spaced  " },
    });
  });

  it("accepts a password of spaces only", () => {
    expect(parseLoginFormData(formData({ name: "alice", password: "        " })).success).toBe(true);
  });

  it("leaves it to the service whether the name can belong to a user", () => {
    expect(parseLoginFormData(formData({ name: "Not A Name!", password: "x" }))).toEqual({
      success: true,
      data: { name: "Not A Name!", password: "x" },
    });
  });

  it("reports an empty name", () => {
    expect(parseLoginFormData(formData({ name: "", password: "secret password" }))).toEqual({
      success: false,
      fieldErrors: { name: ["User name is required"] },
    });
    expect(parseLoginFormData(formData({ name: "   ", password: "secret password" }))).toEqual({
      success: false,
      fieldErrors: { name: ["User name is required"] },
    });
  });

  it("reports an empty password", () => {
    expect(parseLoginFormData(formData({ name: "alice", password: "" }))).toEqual({
      success: false,
      fieldErrors: { password: ["Password is required"] },
    });
  });

  it("reports both errors of an empty form together", () => {
    expect(parseLoginFormData(formData({ name: "", password: "" }))).toEqual({
      success: false,
      fieldErrors: { name: ["User name is required"], password: ["Password is required"] },
    });
  });

  it("counts missing fields as empty", () => {
    expect(parseLoginFormData(new FormData())).toEqual({
      success: false,
      fieldErrors: { name: ["User name is required"], password: ["Password is required"] },
    });
  });

  it("counts a file instead of text as empty", () => {
    const file = new File(["content"], "name.txt");

    expect(parseLoginFormData(formData({ name: file, password: file }))).toEqual({
      success: false,
      fieldErrors: { name: ["User name is required"], password: ["Password is required"] },
    });
  });
});

describe("readPasswordChangeFormData", () => {
  it("returns the three passwords as they are, with their spaces", () => {
    const fields = { currentPassword: " first ", newPassword: "  my own  ", repeatPassword: "  my own  " };

    expect(readPasswordChangeFormData(formData(fields))).toEqual(fields);
  });

  it("counts missing fields and files as empty", () => {
    const file = new File(["content"], "password.txt");

    expect(readPasswordChangeFormData(new FormData())).toEqual({
      currentPassword: "",
      newPassword: "",
      repeatPassword: "",
    });
    expect(
      readPasswordChangeFormData(formData({ currentPassword: file, newPassword: "new", repeatPassword: file })),
    ).toEqual({ currentPassword: "", newPassword: "new", repeatPassword: "" });
  });

  it("ignores other fields, such as a flag that a crafted request adds", () => {
    const fields = { currentPassword: "a", newPassword: "b", repeatPassword: "c" };

    expect(readPasswordChangeFormData(formData({ ...fields, mustChangePassword: "false", userId: "x" }))).toEqual(
      fields,
    );
  });
});
