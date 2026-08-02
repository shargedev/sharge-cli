import { z } from "zod";

export const calendarCreateFieldNames = [
  "title",
  "description",
  "location",
  "timezone",
  "type",
  "start_time",
  "end_time",
  "is_all_day",
  "rrule",
  "enable_alarm",
  "trigger_seconds",
  "trigger_description",
] as const;

export const calendarUpdateFieldNames = [
  ...calendarCreateFieldNames,
  "action",
  "instance_id",
] as const;

const OFFSET_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const UTC_OFFSET = /^(?:UTC)?[+-](?:\d|[01]\d|2[0-3]):[0-5]\d$/;
const SUPPORTED_RRULE_FREQ = /(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/;

export function isOffsetDateTime(value: string): boolean {
  const match = OFFSET_DATETIME.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isEventTimezone(value: string): boolean {
  if (UTC_OFFSET.test(value)) {
    return true;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

const offsetDateTime = z.string().refine(isOffsetDateTime, {
  message: "必须是带显式 offset 的 RFC 3339 时间",
});
const eventTimezone = z.string().refine(isEventTimezone, {
  message: "必须是 IANA timezone 或 UTC±HH:MM",
});
const rrule = z
  .string()
  .min(1)
  .refine((value) => SUPPORTED_RRULE_FREQ.test(value), {
    message: "RRULE 必须包含 FREQ=DAILY、WEEKLY、MONTHLY 或 YEARLY",
  });

const createShape = {
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional().default(null),
  location: z.string().max(255).nullable().optional().default(null),
  timezone: eventTimezone.nullable().optional().default(null),
  type: z.enum(["event", "todo"]).optional().default("event"),
  start_time: offsetDateTime,
  end_time: offsetDateTime.nullable().optional().default(null),
  is_all_day: z.boolean().optional().default(false),
  rrule: rrule.nullable().optional().default(null),
  enable_alarm: z.boolean().nullable().optional().default(null),
  trigger_seconds: z.number().int().min(-864000).optional().default(0),
  trigger_description: z.string().max(255).nullable().optional().default(null),
};

export const calendarCreateZodSchema = z.object(createShape).strict();

const updateShape = {
  title: z.string().min(1).max(255),
  description: z.string().nullable(),
  location: z.string().max(255).nullable(),
  timezone: eventTimezone.nullable(),
  type: z.enum(["event", "todo"]),
  start_time: offsetDateTime,
  end_time: offsetDateTime.nullable(),
  is_all_day: z.boolean(),
  rrule: rrule.nullable(),
  enable_alarm: z.boolean().nullable(),
  trigger_seconds: z.number().int().min(-864000),
  trigger_description: z.string().max(255).nullable(),
  action: z.enum(["all", "instance", "future"]).optional().default("all"),
  instance_id: z.string().min(1).nullable().optional().default(null),
};

export const calendarUpdateZodSchema = z
  .object(updateShape)
  .strict()
  .superRefine((value, context) => {
    if (
      (value.action === "instance" || value.action === "future") &&
      value.instance_id === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["instance_id"],
        message: "action=instance|future 时 instance_id 必填",
      });
    }
    if (value.action === "all" && value.instance_id !== null) {
      context.addIssue({
        code: "custom",
        path: ["instance_id"],
        message: "action=all 时 instance_id 必须为 null",
      });
    }
  });

const nullableStringJsonSchema = {
  anyOf: [{ type: "string" }, { type: "null" }],
};
const nullableDateTimeJsonSchema = {
  anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
};
const nullableBooleanJsonSchema = {
  anyOf: [{ type: "boolean" }, { type: "null" }],
};

const createProperties = {
  title: { type: "string", minLength: 1, maxLength: 255 },
  description: nullableStringJsonSchema,
  location: {
    anyOf: [{ type: "string", maxLength: 255 }, { type: "null" }],
  },
  timezone: nullableStringJsonSchema,
  type: { type: "string", enum: ["event", "todo"], default: "event" },
  start_time: { type: "string", format: "date-time" },
  end_time: nullableDateTimeJsonSchema,
  is_all_day: { type: "boolean", default: false },
  rrule: nullableStringJsonSchema,
  enable_alarm: nullableBooleanJsonSchema,
  trigger_seconds: { type: "integer", minimum: -864000, default: 0 },
  trigger_description: {
    anyOf: [{ type: "string", maxLength: 255 }, { type: "null" }],
  },
};

export const calendarCreateInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "start_time"],
  properties: createProperties,
};

export const calendarUpdateInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [...calendarCreateFieldNames],
  properties: {
    ...createProperties,
    action: {
      type: "string",
      enum: ["all", "instance", "future"],
      default: "all",
    },
    instance_id: nullableStringJsonSchema,
  },
};

export type CalendarCreateInput = z.output<typeof calendarCreateZodSchema>;
export type CalendarUpdateInput = z.output<typeof calendarUpdateZodSchema>;

const calendarId = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/),
]);

export const calendarTodoStatusZodSchema = z
  .object({
    event_ids: z.array(calendarId).min(1),
    status: z.enum(["completed", "uncompleted"]),
  })
  .strict()
  .transform((value) => ({
    ...value,
    event_ids: [
      ...new Map(value.event_ids.map((id) => [String(id), id])).values(),
    ],
  }));

export const calendarTodoStatusInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["event_ids", "status"],
  properties: {
    event_ids: {
      type: "array",
      minItems: 1,
      items: {
        anyOf: [
          { type: "integer", minimum: 1 },
          { type: "string", pattern: "^[1-9]\\d*$" },
        ],
      },
    },
    status: {
      type: "string",
      enum: ["completed", "uncompleted"],
    },
  },
};

export type CalendarTodoStatusInput = z.output<
  typeof calendarTodoStatusZodSchema
>;
