import { z } from "zod";
import { isOffsetDateTime } from "../calendar/input-contract.js";

export const todoId = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine(
    (id) =>
      id.length < 20 || (id.length === 20 && id <= "18446744073709551615"),
    "ID 范围为 1..18446744073709551615；请把 ID 写成十进制字符串，不转成 Number。",
  );
const title = z
  .string()
  .refine(
    (v) => v.trim().length >= 1 && v.trim().length <= 255,
    "标题去掉首尾空白后必须为 1–255 字",
  );
const start = z.string().refine(isOffsetDateTime, "开始时间必须带显式 offset");
const timezone = z.string().refine((value) => {
  if (/^(?:UTC)?[+-](?:\d|[01]\d|2[0-3]):[0-5]\d$/.test(value)) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
});
const ids = z
  .array(todoId)
  .min(1)
  .max(100)
  .transform((v) => [...new Set(v)]);
export const todoInputs = {
  create: z
    .object({
      title,
      start_time: start.nullable().optional(),
      timezone: timezone.optional(),
    })
    .strict(),
  update: z
    .object({
      title: title.optional(),
      start_time: start.nullable().optional(),
    })
    .strict()
    .refine(
      (v) => "title" in v || "start_time" in v,
      "至少修改 title 或 start_time",
    ),
  complete: z.object({ ids, completed: z.boolean() }).strict(),
  delete: z.object({ ids }).strict(),
};
const idJson = {
  type: "string",
  pattern: "^[1-9]\\d*$",
  maxLength: 20,
  description:
    "待办正整数 ID，写成字符串，不转成 Number；最大 18446744073709551615",
};
const titleJson = { type: "string", minLength: 1, maxLength: 255 };
const startJson = {
  anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
};
const idsJson = { type: "array", minItems: 1, maxItems: 100, items: idJson };
export const todoInputSchemas = {
  create: {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: {
      title: titleJson,
      start_time: startJson,
      timezone: { type: "string" },
    },
  },
  update: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: { title: titleJson, start_time: startJson },
  },
  complete: {
    type: "object",
    additionalProperties: false,
    required: ["ids", "completed"],
    properties: { ids: idsJson, completed: { type: "boolean" } },
  },
  delete: {
    type: "object",
    additionalProperties: false,
    required: ["ids"],
    properties: { ids: idsJson },
  },
};
export const todoOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "id",
    "title",
    "start_time",
    "timezone",
    "completed",
    "source_type",
    "source_id",
    "draft",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: idJson,
    title: { type: "string" },
    start_time: startJson,
    timezone: { type: "string" },
    completed: { type: "boolean" },
    source_type: { type: "string" },
    source_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    draft: { type: "boolean" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
};
export const todoReceipt = z
  .object({
    id: z.union([todoId, z.number().int().positive().safe().transform(String)]),
    title: z.string(),
    start_time: z.string().nullable(),
    timezone: z.string(),
    completed: z.boolean(),
    source_type: z.string(),
    source_id: z.string().nullable(),
    draft: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();
export const todoPage = z
  .object({
    items: z.array(todoReceipt),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  })
  .passthrough();
export const todoChanged = z
  .object({ changed_count: z.number().int().nonnegative() })
  .passthrough();
