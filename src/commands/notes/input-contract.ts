import { z } from "zod";

export const notesUpdateFieldNames = ["title", "content"] as const;

const updateNoteShape = Object.fromEntries(
  notesUpdateFieldNames.map((field) => [
    field,
    z.string().nullable().optional(),
  ]),
) as Record<
  (typeof notesUpdateFieldNames)[number],
  z.ZodOptional<z.ZodNullable<z.ZodString>>
>;

export const notesUpdateZodSchema = z
  .object(updateNoteShape)
  .strict()
  .refine((value) => "title" in value || "content" in value);

const nullableStringJsonSchema = {
  anyOf: [{ type: "string" }, { type: "null" }],
};

export const notesUpdateInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: Object.fromEntries(
    notesUpdateFieldNames.map((field) => [field, nullableStringJsonSchema]),
  ) as Record<
    (typeof notesUpdateFieldNames)[number],
    typeof nullableStringJsonSchema
  >,
};
