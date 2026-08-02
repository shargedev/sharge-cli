import packageJson from "../../package.json" with { type: "json" };
import { apiOperations } from "../api/operations.js";
import { runAuthScopes } from "../commands/auth/scopes.js";
import { runAuthStatus } from "../commands/auth/status.js";
import {
  calendarCreateInputJsonSchema,
  calendarTodoStatusInputJsonSchema,
  calendarUpdateInputJsonSchema,
} from "../commands/calendar/input-contract.js";
import {
  runCalendarDelete,
  runCalendarTodoSetStatus,
} from "../commands/calendar/mutate.js";
import {
  runCalendarGet,
  runCalendarList,
  runCalendarMonth,
  runCalendarSearch,
} from "../commands/calendar/read.js";
import {
  runCalendarCreate,
  runCalendarUpdate,
} from "../commands/calendar/write.js";
import { runConfigSet } from "../commands/config/set.js";
import { runConfigShow } from "../commands/config/show.js";
import { runConfigUnset } from "../commands/config/unset.js";
import {
  runDiaryGet,
  runDiaryList,
  runDiarySearch,
} from "../commands/diary/read.js";
import { runDoctor } from "../commands/doctor.js";
import { runLogin } from "../commands/login.js";
import { runLogout } from "../commands/logout.js";
import { runLogsClear } from "../commands/logs/clear.js";
import { runLogsPath } from "../commands/logs/path.js";
import { runNotesDownload } from "../commands/notes/download.js";
import { notesUpdateInputJsonSchema } from "../commands/notes/input-contract.js";
import {
  runNotesGet,
  runNotesList,
  runNotesSearch,
} from "../commands/notes/read.js";
import { runNotesDelete, runNotesUpdate } from "../commands/notes/write.js";
import { runRecordingsDownload } from "../commands/recordings/download.js";
import {
  runRecordingsGet,
  runRecordingsList,
  runRecordingsSearch,
} from "../commands/recordings/read.js";
import type { CliRuntime } from "../runtime/context.js";
import { parseTimeoutMs } from "../runtime/duration.js";
import type { CliErrorType, RecoveryAction } from "../runtime/errors.js";
import { OPEN_PLATFORM_SCOPES } from "../runtime/scopes.js";

export type ArgumentDefinition = {
  name: string;
  description: string;
  required: boolean;
  variadic: boolean;
  enum?: string[];
};

export type OptionDefinition = {
  name: string;
  aliases: string[];
  type: "boolean" | "string";
  description: string;
  default: boolean | string | null;
  enum: string[] | null;
  repeatable: boolean;
  exclusiveWith: string[];
  required?: boolean;
};

export type CommandContext = {
  arguments: Record<string, string>;
  options: Record<string, boolean | string | string[]>;
  runtime: CliRuntime;
  emitStatus: (status: {
    event: string;
    message: string;
    [key: string]: unknown;
  }) => void;
};

export type CommandExecution = {
  text: string;
  data: unknown;
  warnings?: {
    type: string;
    message: string;
    nextActions?: RecoveryAction[];
  }[];
  exitCode?: number;
  meta?: {
    requestId: string | null;
    timezone: string;
    clientDate: string;
  };
};

export type CommandDefinition = {
  command: string;
  path: string[];
  description: string;
  requiredScopes: string[];
  arguments: ArgumentDefinition[];
  options: OptionDefinition[];
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown>;
  network: boolean;
  sideEffects: string[];
  destructive: boolean;
  dryRun: boolean;
  retrySafe: boolean;
  timeout: number | null;
  pagination: Record<string, unknown> | null;
  errors: CliErrorType[];
  examples: string[];
  handler: ((context: CommandContext) => Promise<CommandExecution>) | null;
};

const helpOption: OptionDefinition = {
  name: "--help",
  aliases: ["-h"],
  type: "boolean",
  description: "显示帮助",
  default: false,
  enum: null,
  repeatable: false,
  exclusiveWith: [],
};

const jsonOption: OptionDefinition = {
  name: "--json",
  aliases: [],
  type: "boolean",
  description: "输出结构化 JSON",
  default: false,
  enum: null,
  repeatable: false,
  exclusiveWith: [],
};

const yesOption: OptionDefinition = {
  name: "--yes",
  aliases: [],
  type: "boolean",
  description: "确认执行明确请求的破坏性操作",
  default: false,
  enum: null,
  repeatable: false,
  exclusiveWith: [],
};

const timezoneOption: OptionDefinition = {
  name: "--timezone",
  aliases: [],
  type: "string",
  description: "本次调用使用的 IANA timezone",
  default: null,
  enum: null,
  repeatable: false,
  exclusiveWith: [],
};

const debugOption: OptionDefinition = {
  name: "--debug",
  aliases: [],
  type: "boolean",
  description: "将本地诊断写入 stderr",
  default: false,
  enum: null,
  repeatable: false,
  exclusiveWith: [],
};

const timeoutOption: OptionDefinition = {
  name: "--timeout",
  aliases: [],
  type: "string",
  description: "总超时，必须使用 s 或 m 单位",
  default: "30s",
  enum: null,
  repeatable: false,
  exclusiveWith: [],
};

const jqOption: OptionDefinition = {
  name: "--jq",
  aliases: [],
  type: "string",
  description: "使用内置 jq 过滤 JSON success 结果",
  default: null,
  enum: null,
  repeatable: false,
  exclusiveWith: [],
};

const networkErrors: CliErrorType[] = [
  "AUTH_REQUIRED",
  "CREDENTIAL_INVALID",
  "INVALID_INPUT",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "NETWORK_ERROR",
  "TIMEOUT",
  "SERVER_ERROR",
];

const loginErrors: CliErrorType[] = [
  ...networkErrors,
  "AUTHORIZATION_DENIED",
  "AUTHORIZATION_EXPIRED",
  "AUTHORIZATION_CONSUMED",
  "AUTHORIZATION_SUPERSEDED",
  "CANCELLED",
];

const notesReadErrors: CliErrorType[] = [...networkErrors, "SCOPE_REQUIRED"];
const calendarReadErrors: CliErrorType[] = [
  ...networkErrors,
  "SCOPE_REQUIRED",
  "CANCELLED",
];

const noteIdOutputSchema = {
  anyOf: [{ type: "integer" }, { type: "string" }],
};

const nullableStringOutputSchema = {
  anyOf: [{ type: "string" }, { type: "null" }],
};

const nullableNumberOutputSchema = {
  anyOf: [{ type: "number" }, { type: "null" }],
};

const noteOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "id",
    "title",
    "content",
    "status",
    "location",
    "longitude",
    "latitude",
    "has_calendar_events",
    "available_media_types",
    "media_downloads",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: noteIdOutputSchema,
    title: nullableStringOutputSchema,
    content: nullableStringOutputSchema,
    status: {
      type: "string",
      enum: ["pending", "processing", "success", "failed"],
    },
    location: nullableStringOutputSchema,
    longitude: nullableNumberOutputSchema,
    latitude: nullableNumberOutputSchema,
    has_calendar_events: { type: "boolean" },
    available_media_types: {
      type: "array",
      items: {
        type: "string",
        enum: ["audio", "image", "video"],
      },
    },
    media_downloads: {
      type: "object",
      propertyNames: {
        enum: ["audio", "image", "video"],
      },
      additionalProperties: { type: "string" },
    },
    matched_fields: {
      type: "array",
      items: {
        type: "string",
        enum: ["title", "content"],
      },
    },
    matched_title: nullableStringOutputSchema,
    matched_content: nullableStringOutputSchema,
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
};

const notePageOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["items", "has_more", "next_cursor"],
  properties: {
    items: {
      type: "array",
      items: noteOutputSchema,
    },
    has_more: { type: "boolean" },
    next_cursor: {
      anyOf: [{ type: "integer" }, { type: "string" }, { type: "null" }],
    },
  },
};

const dryRunPlanOutputSchema = {
  type: "object",
  required: [
    "method",
    "url",
    "path",
    "body",
    "requiredScopes",
    "sideEffects",
    "retrySafe",
    "unverified",
  ],
  properties: {
    method: { type: "string", enum: ["POST", "PATCH", "PUT", "DELETE"] },
    url: { type: "string" },
    path: { type: "string" },
    body: {},
    requiredScopes: { type: "array", items: { type: "string" } },
    sideEffects: { type: "array", items: { type: "string" } },
    retrySafe: { type: "boolean" },
    unverified: { type: "array", items: { type: "string" } },
  },
};

const downloadResultOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["filePath", "bytes", "mediaType", "sha256"],
  properties: {
    filePath: { type: "string" },
    bytes: { type: "integer", minimum: 0 },
    mediaType: { type: "string" },
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
};

const downloadDryRunOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "method",
    "url",
    "path",
    "filePath",
    "fileNameSource",
    "overwrite",
    "requiredScopes",
    "unverified",
  ],
  properties: {
    method: { type: "string", enum: ["GET"] },
    url: { type: "string" },
    path: { type: "string" },
    filePath: { type: "string" },
    fileNameSource: {
      type: "string",
      enum: ["explicit", "fallback"],
    },
    overwrite: { type: "boolean" },
    requiredScopes: { type: "array", items: { type: "string" } },
    unverified: { type: "array", items: { type: "string" } },
  },
};

const calendarEventOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "id",
    "title",
    "type",
    "description",
    "location",
    "start_time",
    "end_time",
    "is_all_day",
    "timezone",
    "rrule",
    "excluded_dates",
    "enable_alarm",
    "trigger_seconds",
    "trigger_description",
    "source_type",
    "source_id",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: noteIdOutputSchema,
    title: { type: "string" },
    type: { type: "string", enum: ["event", "todo"] },
    description: nullableStringOutputSchema,
    location: nullableStringOutputSchema,
    start_time: { type: "string", format: "date-time" },
    end_time: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
    },
    is_all_day: { type: "boolean" },
    timezone: { type: "string" },
    rrule: nullableStringOutputSchema,
    excluded_dates: {
      anyOf: [
        {
          type: "array",
          items: { type: "string", format: "date-time" },
        },
        { type: "null" },
      ],
    },
    enable_alarm: { type: "boolean" },
    trigger_seconds: { type: "integer" },
    trigger_description: nullableStringOutputSchema,
    source_type: {
      type: "string",
      enum: ["manual", "quick_note", "audio_recorded"],
    },
    source_id: nullableStringOutputSchema,
    completed: {
      anyOf: [{ type: "boolean" }, { type: "null" }],
    },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
};

const calendarInstanceOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "instance_id",
    "event_id",
    "original_start_time",
    "original_end_time",
    "actual_start_time",
    "actual_end_time",
    "trigger_start_time",
    "is_cancelled",
    "created_at",
    "updated_at",
  ],
  properties: {
    instance_id: { type: "string" },
    event_id: noteIdOutputSchema,
    original_start_time: { type: "string", format: "date-time" },
    original_end_time: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
    },
    actual_start_time: { type: "string", format: "date-time" },
    actual_end_time: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
    },
    trigger_start_time: { type: "string", format: "date-time" },
    is_cancelled: { type: "boolean" },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
};

const calendarMonthOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["dates", "events", "has_new_instances"],
  properties: {
    dates: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: calendarInstanceOutputSchema,
      },
    },
    events: {
      type: "object",
      additionalProperties: calendarEventOutputSchema,
    },
    has_new_instances: { type: "boolean" },
  },
};

const calendarRangeOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["events", "instances"],
  properties: {
    events: {
      type: "array",
      items: calendarEventOutputSchema,
    },
    instances: {
      type: "array",
      items: calendarInstanceOutputSchema,
    },
  },
};

const calendarSearchOutputSchema = {
  type: "array",
  items: {
    ...calendarEventOutputSchema,
    required: [...calendarEventOutputSchema.required, "matched_title"],
    properties: {
      ...calendarEventOutputSchema.properties,
      matched_title: { type: "string" },
    },
  },
};

const calendarUpdateResultOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["action", "created_events", "updated_events", "deleted_events"],
  properties: {
    action: {
      type: "string",
      enum: ["all", "instance", "future"],
    },
    created_events: {
      type: "array",
      items: calendarEventOutputSchema,
    },
    updated_events: {
      type: "array",
      items: calendarEventOutputSchema,
    },
    deleted_events: {
      type: "array",
      items: calendarEventOutputSchema,
    },
  },
};

const calendarTodoStatusOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["completed_ids", "uncompleted_ids"],
  properties: {
    completed_ids: {
      type: "array",
      items: noteIdOutputSchema,
    },
    uncompleted_ids: {
      type: "array",
      items: noteIdOutputSchema,
    },
  },
};

const recordingOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "recording_id",
    "voice_id",
    "recording_type",
    "title",
    "summary",
    "timestamp",
    "duration_minutes",
    "location",
    "status_code",
    "has_summary",
    "audio_download_path",
    "created_at",
    "updated_at",
  ],
  properties: {
    recording_id: noteIdOutputSchema,
    voice_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    recording_type: {
      type: "string",
      enum: ["ordinary", "call", "app_related"],
    },
    title: { anyOf: [{ type: "string" }, { type: "null" }] },
    summary: { anyOf: [{ type: "string" }, { type: "null" }] },
    timestamp: { type: "integer" },
    duration_minutes: { anyOf: [{ type: "number" }, { type: "null" }] },
    location: { anyOf: [{ type: "string" }, { type: "null" }] },
    status_code: { anyOf: [{ type: "integer" }, { type: "null" }] },
    has_summary: { type: "boolean" },
    audio_download_path: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
};

const recordingsPageOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["items", "next_cursor", "prev_cursor", "has_more"],
  properties: {
    items: { type: "array", items: recordingOutputSchema },
    next_cursor: {
      anyOf: [noteIdOutputSchema, { type: "null" }],
    },
    prev_cursor: {
      anyOf: [noteIdOutputSchema, { type: "null" }],
    },
    has_more: { type: "boolean" },
  },
};

const recordingsSearchOutputSchema = {
  type: "array",
  items: {
    ...recordingOutputSchema,
    required: [
      ...recordingOutputSchema.required,
      "language",
      "summary_template_id",
      "matched_fields",
      "matched_texts",
    ],
    properties: {
      ...recordingOutputSchema.properties,
      language: { anyOf: [{ type: "string" }, { type: "null" }] },
      summary_template_id: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      matched_fields: {
        type: "array",
        items: { type: "string", enum: ["title", "summary"] },
      },
      matched_texts: {
        type: "object",
        additionalProperties: { type: "string" },
      },
    },
  },
};

const recordingDetailOutputSchema = {
  ...recordingOutputSchema,
  required: [
    ...recordingOutputSchema.required,
    "evaluate_time",
    "transcript",
    "overviews",
    "speaker_map",
    "highlights",
  ],
  properties: {
    ...recordingOutputSchema.properties,
    evaluate_time: {
      anyOf: [{ type: "integer" }, { type: "null" }],
    },
    transcript: {
      type: "object",
      additionalProperties: true,
      required: ["recording_id", "status_code", "text", "segments"],
      properties: {
        recording_id: noteIdOutputSchema,
        status_code: { anyOf: [{ type: "integer" }, { type: "null" }] },
        text: { anyOf: [{ type: "string" }, { type: "null" }] },
        segments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
            required: ["start_time", "end_time", "speaker", "text"],
            properties: {
              start_time: {
                anyOf: [{ type: "number" }, { type: "null" }],
              },
              end_time: {
                anyOf: [{ type: "number" }, { type: "null" }],
              },
              speaker: {
                anyOf: [{ type: "string" }, { type: "null" }],
              },
              text: { type: "string" },
            },
          },
        },
      },
    },
    overviews: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: true,
        properties: {
          title: { anyOf: [{ type: "string" }, { type: "null" }] },
          abstract: { anyOf: [{ type: "string" }, { type: "null" }] },
          duration_seconds: {
            anyOf: [{ type: "number" }, { type: "null" }],
          },
          summaries: {
            type: "object",
            additionalProperties: { type: "string" },
          },
          keywords: { type: "array", items: { type: "string" } },
          mind_map: { anyOf: [{ type: "string" }, { type: "null" }] },
          chapters: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              required: ["title", "content"],
              properties: {
                start_time: {
                  anyOf: [{ type: "number" }, { type: "null" }],
                },
                title: { type: "string" },
                content: { type: "string" },
              },
            },
          },
          has_calendar: {
            anyOf: [{ type: "boolean" }, { type: "null" }],
          },
        },
      },
    },
    speaker_map: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: true,
        required: ["speaker_id", "name"],
        properties: {
          speaker_id: { type: "string" },
          name: { type: "string" },
        },
      },
    },
    highlights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["at_ms", "duration_ms", "text", "media_type"],
        properties: {
          at_ms: { type: "integer", minimum: 0 },
          duration_ms: { type: "integer", minimum: 0 },
          text: { anyOf: [{ type: "string" }, { type: "null" }] },
          media_type: {
            type: "string",
            enum: ["audio", "image", "video", "quick_note", "ai_note"],
          },
        },
      },
    },
  },
};

const diaryDocumentOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "identifier",
    "duration_seconds",
    "extra",
    "title",
    "description",
    "cover_thumbnail_url",
    "cover_large_url",
    "generated_at",
    "updated_at",
  ],
  properties: {
    identifier: { type: "string", pattern: "^\\d{8}$" },
    duration_seconds: { type: "number", minimum: 0 },
    extra: {
      type: "object",
      additionalProperties: false,
      required: ["city", "keywords", "recording_count"],
      properties: {
        city: { anyOf: [{ type: "string" }, { type: "null" }] },
        keywords: { type: "array", items: { type: "string" } },
        recording_count: { type: "integer", minimum: 0 },
      },
    },
    title: { type: "string" },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    cover_thumbnail_url: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    cover_large_url: { anyOf: [{ type: "string" }, { type: "null" }] },
    generated_at: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
    },
    updated_at: { type: "string", format: "date-time" },
  },
};

const diaryDetailOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "report_type",
    "identifier",
    "status",
    "timezone",
    "period_start",
    "period_end",
    "title",
    "description",
    "summary",
    "duration_seconds",
    "markdown",
    "word_count",
    "generated_at",
    "updated_at",
  ],
  properties: {
    report_type: { type: "string", enum: ["daily"] },
    identifier: { type: "string", pattern: "^\\d{8}$" },
    status: {
      type: "string",
      enum: [
        "waiting",
        "queued",
        "processing",
        "success",
        "failed",
        "cancelled",
      ],
    },
    timezone: { type: "string" },
    period_start: { type: "string", format: "date-time" },
    period_end: { type: "string", format: "date-time" },
    title: { anyOf: [{ type: "string" }, { type: "null" }] },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    summary: { anyOf: [{ type: "string" }, { type: "null" }] },
    duration_seconds: { anyOf: [{ type: "number" }, { type: "null" }] },
    markdown: { anyOf: [{ type: "string" }, { type: "null" }] },
    word_count: {
      anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
    },
    generated_at: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
    },
    updated_at: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
    },
  },
};

const calendarSourceTypeOption: OptionDefinition = {
  name: "--source-type",
  aliases: [],
  type: "string",
  description: "来源过滤：all、manual、quick_note 或 audio_recorded；默认 all",
  default: "all",
  enum: ["all", "manual", "quick_note", "audio_recorded"],
  repeatable: false,
  exclusiveWith: [],
};

function calendarWriteOptions(
  includeUpdateFields: boolean,
): OptionDefinition[] {
  const businessNames = [
    "--title",
    "--description",
    "--location",
    "--event-timezone",
    "--type",
    "--start-time",
    "--end-time",
    "--is-all-day",
    "--rrule",
    "--enable-alarm",
    "--trigger-seconds",
    "--trigger-description",
    ...(includeUpdateFields ? ["--action", "--instance-id"] : []),
  ];
  const business = (
    name: string,
    description: string,
    enumValues: string[] | null = null,
    defaultValue: string | null = null,
  ): OptionDefinition => ({
    name,
    aliases: [],
    type: "string",
    description,
    default: defaultValue,
    enum: enumValues,
    repeatable: false,
    exclusiveWith: ["--input", "--generate-input"],
  });
  return [
    business("--title", "标题，1–255 字符；flags 模式必填"),
    business("--description", "描述；省略时为 null"),
    business("--location", "地点，最多 255 字符；省略时为 null"),
    business(
      "--event-timezone",
      "业务对象 timezone：IANA 名或 UTC±HH:MM；省略时为 null",
    ),
    business(
      "--type",
      "Calendar 类型：event 或 todo",
      ["event", "todo"],
      "event",
    ),
    business("--start-time", "开始时间，必须带显式 offset；flags 模式必填"),
    business("--end-time", "结束时间，必须带显式 offset；省略时为 null"),
    business(
      "--is-all-day",
      "是否全天：true 或 false",
      ["true", "false"],
      "false",
    ),
    business("--rrule", "RFC 5545 RRULE；省略时为 null"),
    business("--enable-alarm", "是否启用提醒：true 或 false", [
      "true",
      "false",
    ]),
    business(
      "--trigger-seconds",
      "提醒相对开始时间的整数秒，最小 -864000",
      null,
      "0",
    ),
    business("--trigger-description", "提醒描述，最多 255 字符；省略时为 null"),
    ...(includeUpdateFields
      ? [
          business(
            "--action",
            "更新范围：all、instance 或 future",
            ["all", "instance", "future"],
            "all",
          ),
          business(
            "--instance-id",
            "服务端返回的 opaque instance ID；instance/future 必填",
          ),
        ]
      : []),
    {
      name: "--input",
      aliases: [],
      type: "string",
      description: "inline JSON、@file 或 -（stdin）",
      default: null,
      enum: null,
      repeatable: false,
      exclusiveWith: [...businessNames, "--generate-input"],
    },
    {
      name: "--generate-input",
      aliases: [],
      type: "boolean",
      description: "离线输出可直接回填的完整原始 JSON 模板",
      default: false,
      enum: null,
      repeatable: false,
      exclusiveWith: [
        ...businessNames,
        "--input",
        "--dry-run",
        "--json",
        "--jq",
      ],
    },
    {
      name: "--dry-run",
      aliases: [],
      type: "boolean",
      description: "只输出零网络执行计划",
      default: false,
      enum: null,
      repeatable: false,
      exclusiveWith: ["--generate-input"],
    },
  ];
}

function calendarWriteHandlerOptions(context: CommandContext) {
  const stringOption = (name: string) =>
    typeof context.options[name] === "string"
      ? context.options[name]
      : undefined;
  return {
    input: stringOption("--input"),
    title: stringOption("--title"),
    description: stringOption("--description"),
    location: stringOption("--location"),
    eventTimezone: stringOption("--event-timezone"),
    type: stringOption("--type"),
    startTime: stringOption("--start-time"),
    endTime: stringOption("--end-time"),
    isAllDay: stringOption("--is-all-day"),
    rrule: stringOption("--rrule"),
    enableAlarm: stringOption("--enable-alarm"),
    triggerSeconds: stringOption("--trigger-seconds"),
    triggerDescription: stringOption("--trigger-description"),
    action: stringOption("--action"),
    instanceId: stringOption("--instance-id"),
    generateInput: context.options["--generate-input"] === true,
    dryRun: context.options["--dry-run"] === true,
    json: context.options["--json"] === true,
    jq: stringOption("--jq"),
    timeoutMs: parseTimeoutMs(stringOption("--timeout")),
    timezoneOverride: stringOption("--timezone"),
  };
}

export const rootCommandDefinition: CommandDefinition = {
  command: "sharge",
  path: [],
  description: "面向 Agent 的 Sharge 开放平台命令行工具",
  requiredScopes: [],
  arguments: [],
  options: [
    jsonOption,
    helpOption,
    yesOption,
    timezoneOption,
    timeoutOption,
    jqOption,
    debugOption,
  ],
  inputSchema: null,
  outputSchema: {
    type: "object",
  },
  network: false,
  sideEffects: [],
  destructive: false,
  dryRun: false,
  retrySafe: true,
  timeout: null,
  pagination: null,
  errors: ["INVALID_COMMAND"],
  examples: ["sharge --help --json", "sharge version"],
  handler: null,
};

export const commandDefinitions: CommandDefinition[] = [
  {
    command: "login",
    path: ["login"],
    description: "通过浏览器授权并将 API Key 保存到 settings",
    requiredScopes: [],
    arguments: [],
    options: [
      {
        name: "--scope",
        aliases: [],
        type: "string",
        description: "目标 scope；可重复，显式值构成完整授权集合",
        default: null,
        enum: [...OPEN_PLATFORM_SCOPES],
        repeatable: true,
        exclusiveWith: [],
      },
      {
        name: "--no-browser",
        aliases: [],
        type: "boolean",
        description: "不自动打开浏览器，仍显示完整授权 URL",
        default: false,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--force",
        aliases: [],
        type: "boolean",
        description: "跳过现有凭证检查并重新授权",
        default: false,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
    ],
    inputSchema: null,
    outputSchema: {
      type: "object",
      required: ["changed", "scopes"],
    },
    network: true,
    sideEffects: [
      "create_authorization_session",
      "open_browser",
      "rotate_api_key",
      "update_settings",
    ],
    destructive: false,
    dryRun: false,
    retrySafe: false,
    timeout: null,
    pagination: null,
    errors: loginErrors,
    examples: [
      "sharge login",
      "sharge login --no-browser --json",
      "sharge login --force",
    ],
    handler: async (context) =>
      runLogin(context.runtime, {
        noBrowser: context.options["--no-browser"] === true,
        force: context.options["--force"] === true,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
        scopes: Array.isArray(context.options["--scope"])
          ? context.options["--scope"]
          : typeof context.options["--scope"] === "string"
            ? [context.options["--scope"]]
            : undefined,
        emitStatus: context.emitStatus,
      }),
  },
  {
    command: "logout",
    path: ["logout"],
    description: "删除本地文件凭证，不撤销服务端 API Key",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: {
      type: "object",
      required: [
        "changed",
        "settingsCredentialRemoved",
        "previousCredentialRemoved",
        "environmentCredentialActive",
      ],
      properties: {
        changed: { type: "boolean" },
        settingsCredentialRemoved: { type: "boolean" },
        previousCredentialRemoved: { type: "boolean" },
        environmentCredentialActive: { type: "boolean" },
      },
    },
    network: false,
    sideEffects: ["update_settings"],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INTERNAL_ERROR"],
    examples: ["sharge logout", "sharge logout --json"],
    handler: async (context) => runLogout(context.runtime),
  },
  {
    command: "notes",
    path: ["notes"],
    description: "读取和管理 Quick Note",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: { type: "object" },
    network: false,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INVALID_COMMAND"],
    examples: ["sharge notes --help", "sharge notes --help --json"],
    handler: null,
  },
  {
    command: "notes.list",
    path: ["notes", "list"],
    description: "读取一页 Quick Note",
    requiredScopes: [...apiOperations.notesList.requiredScopes],
    arguments: [],
    options: [
      {
        name: "--cursor",
        aliases: [],
        type: "string",
        description: "上一页返回的 opaque ID cursor",
        default: "0",
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--limit",
        aliases: [],
        type: "string",
        description: "当前页最大条数，1–100",
        default: "20",
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--created-at-start",
        aliases: [],
        type: "string",
        description: "创建时间下界，必须带显式 offset",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--created-at-end",
        aliases: [],
        type: "string",
        description: "创建时间上界，必须带显式 offset",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
    ],
    inputSchema: null,
    outputSchema: notePageOutputSchema,
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: {
      type: "cursor",
      requestField: "cursor",
      nextField: "next_cursor",
      hasMoreField: "has_more",
      autoPaginate: false,
      defaultLimit: 20,
      maxLimit: 100,
    },
    errors: notesReadErrors,
    examples: ["sharge notes list", "sharge notes list --limit 20 --json"],
    handler: async (context) =>
      runNotesList(context.runtime, {
        cursor:
          typeof context.options["--cursor"] === "string"
            ? context.options["--cursor"]
            : undefined,
        limit:
          typeof context.options["--limit"] === "string"
            ? context.options["--limit"]
            : undefined,
        createdAtStart:
          typeof context.options["--created-at-start"] === "string"
            ? context.options["--created-at-start"]
            : undefined,
        createdAtEnd:
          typeof context.options["--created-at-end"] === "string"
            ? context.options["--created-at-end"]
            : undefined,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "notes.search",
    path: ["notes", "search"],
    description: "按标题和正文搜索一页 Quick Note",
    requiredScopes: [...apiOperations.notesList.requiredScopes],
    arguments: [
      {
        name: "query",
        description: "必填搜索词",
        required: true,
        variadic: false,
      },
    ],
    options: [
      {
        name: "--cursor",
        aliases: [],
        type: "string",
        description: "上一页返回的 opaque ID cursor",
        default: "0",
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--limit",
        aliases: [],
        type: "string",
        description: "当前页最大条数，1–100",
        default: "20",
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--created-at-start",
        aliases: [],
        type: "string",
        description: "创建时间下界，必须带显式 offset",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--created-at-end",
        aliases: [],
        type: "string",
        description: "创建时间上界，必须带显式 offset",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
    ],
    inputSchema: null,
    outputSchema: notePageOutputSchema,
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: {
      type: "cursor",
      requestField: "cursor",
      nextField: "next_cursor",
      hasMoreField: "has_more",
      autoPaginate: false,
      defaultLimit: 20,
      maxLimit: 100,
    },
    errors: notesReadErrors,
    examples: [
      "sharge notes search '发布计划'",
      "sharge notes search '发布计划' --limit 20 --json",
    ],
    handler: async (context) =>
      runNotesSearch(context.runtime, context.arguments.query, {
        cursor:
          typeof context.options["--cursor"] === "string"
            ? context.options["--cursor"]
            : undefined,
        limit:
          typeof context.options["--limit"] === "string"
            ? context.options["--limit"]
            : undefined,
        createdAtStart:
          typeof context.options["--created-at-start"] === "string"
            ? context.options["--created-at-start"]
            : undefined,
        createdAtEnd:
          typeof context.options["--created-at-end"] === "string"
            ? context.options["--created-at-end"]
            : undefined,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "notes.get",
    path: ["notes", "get"],
    description: "按 ID 读取一条完整 Quick Note",
    requiredScopes: [...apiOperations.notesGet.requiredScopes],
    arguments: [
      {
        name: "note-id",
        description: "Quick Note 正整数 ID",
        required: true,
        variadic: false,
      },
    ],
    options: [],
    inputSchema: null,
    outputSchema: noteOutputSchema,
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: notesReadErrors,
    examples: ["sharge notes get 123", "sharge notes get 123 --json"],
    handler: async (context) =>
      runNotesGet(context.runtime, context.arguments["note-id"], {
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "notes.update",
    path: ["notes", "update"],
    description: "修改 Quick Note 的标题和/或正文",
    requiredScopes: [...apiOperations.notesUpdate.requiredScopes],
    arguments: [
      {
        name: "note-id",
        description: "Quick Note 正整数 ID",
        required: true,
        variadic: false,
      },
    ],
    options: [
      {
        name: "--title",
        aliases: [],
        type: "string",
        description: "新的标题",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: ["--input", "--generate-input"],
      },
      {
        name: "--content",
        aliases: [],
        type: "string",
        description: "新的正文",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: ["--input", "--generate-input"],
      },
      {
        name: "--input",
        aliases: [],
        type: "string",
        description: "inline JSON、@file 或 -（stdin）",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: ["--title", "--content", "--generate-input"],
      },
      {
        name: "--generate-input",
        aliases: [],
        type: "boolean",
        description: "离线输出可直接回填的原始 JSON 模板",
        default: false,
        enum: null,
        repeatable: false,
        exclusiveWith: ["--title", "--content", "--input", "--json", "--jq"],
      },
      {
        name: "--dry-run",
        aliases: [],
        type: "boolean",
        description: "只输出零网络执行计划",
        default: false,
        enum: null,
        repeatable: false,
        exclusiveWith: ["--generate-input"],
      },
    ],
    inputSchema: notesUpdateInputJsonSchema,
    outputSchema: {
      anyOf: [noteOutputSchema, dryRunPlanOutputSchema],
    },
    network: true,
    sideEffects: ["update_quick_note", "update_related_calendar_events"],
    destructive: false,
    dryRun: true,
    retrySafe: false,
    timeout: 30_000,
    pagination: null,
    errors: notesReadErrors,
    examples: [
      "sharge notes update 123 --title '新标题' --json",
      "sharge notes update 123 --input @update.json --dry-run --json",
      "sharge notes update 123 --generate-input",
    ],
    handler: async (context) =>
      runNotesUpdate(context.runtime, context.arguments["note-id"], {
        input:
          typeof context.options["--input"] === "string"
            ? context.options["--input"]
            : undefined,
        title:
          typeof context.options["--title"] === "string"
            ? context.options["--title"]
            : undefined,
        content:
          typeof context.options["--content"] === "string"
            ? context.options["--content"]
            : undefined,
        generateInput: context.options["--generate-input"] === true,
        dryRun: context.options["--dry-run"] === true,
        json: context.options["--json"] === true,
        jq:
          typeof context.options["--jq"] === "string"
            ? context.options["--jq"]
            : undefined,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "notes.delete",
    path: ["notes", "delete"],
    description: "不可恢复地删除一条 Quick Note",
    requiredScopes: [...apiOperations.notesDelete.requiredScopes],
    arguments: [
      {
        name: "note-id",
        description: "Quick Note 正整数 ID",
        required: true,
        variadic: false,
      },
    ],
    options: [
      {
        name: "--dry-run",
        aliases: [],
        type: "boolean",
        description: "只输出零网络执行计划，不要求 --yes",
        default: false,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
    ],
    inputSchema: null,
    outputSchema: {
      anyOf: [{ type: "null" }, dryRunPlanOutputSchema],
    },
    network: true,
    sideEffects: ["delete_quick_note", "delete_related_calendar_events"],
    destructive: true,
    dryRun: true,
    retrySafe: false,
    timeout: 30_000,
    pagination: null,
    errors: notesReadErrors,
    examples: [
      "sharge notes delete 123 --yes --json",
      "sharge notes delete 123 --dry-run --json",
    ],
    handler: async (context) =>
      runNotesDelete(context.runtime, context.arguments["note-id"], {
        yes: context.options["--yes"] === true,
        dryRun: context.options["--dry-run"] === true,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "notes.download",
    path: ["notes", "download"],
    description: "将 Quick Note 媒体安全下载到本地文件",
    requiredScopes: [...apiOperations.notesDownload.requiredScopes],
    arguments: [
      {
        name: "note-id",
        description: "Quick Note 正整数 ID",
        required: true,
        variadic: false,
      },
    ],
    options: [
      {
        name: "--media",
        aliases: [],
        type: "string",
        description: "媒体类型：audio、image 或 video",
        default: null,
        enum: ["audio", "image", "video"],
        repeatable: false,
        exclusiveWith: [],
        required: true,
      },
      {
        name: "--file",
        aliases: [],
        type: "string",
        description: "显式本地目标路径；不支持 -",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--overwrite",
        aliases: [],
        type: "boolean",
        description: "允许覆盖显式目标文件",
        default: false,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--dry-run",
        aliases: [],
        type: "boolean",
        description: "只输出零网络下载计划，不创建文件",
        default: false,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
    ],
    inputSchema: null,
    outputSchema: {
      anyOf: [downloadResultOutputSchema, downloadDryRunOutputSchema],
    },
    network: true,
    sideEffects: ["write_download_file"],
    destructive: false,
    dryRun: true,
    retrySafe: true,
    timeout: 600_000,
    pagination: null,
    errors: [...notesReadErrors, "FILE_EXISTS", "FILE_IO_ERROR", "CANCELLED"],
    examples: [
      "sharge notes download 123 --media image",
      "sharge notes download 123 --media image --json",
      "sharge notes download 123 --media image --file ./photo.jpg --overwrite --json",
      "sharge notes download 123 --media image --dry-run --json",
    ],
    handler: async (context) =>
      runNotesDownload(context.runtime, context.arguments["note-id"], {
        media:
          typeof context.options["--media"] === "string"
            ? context.options["--media"]
            : undefined,
        file:
          typeof context.options["--file"] === "string"
            ? context.options["--file"]
            : undefined,
        overwrite: context.options["--overwrite"] === true,
        dryRun: context.options["--dry-run"] === true,
        json: context.options["--json"] === true,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "calendar",
    path: ["calendar"],
    description: "读取和管理 Calendar",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: { type: "object" },
    network: false,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INVALID_COMMAND"],
    examples: ["sharge calendar --help", "sharge calendar --help --json"],
    handler: null,
  },
  {
    command: "calendar.month",
    path: ["calendar", "month"],
    description: "读取一个明确月份的 Calendar 月视图",
    requiredScopes: [...apiOperations.calendarMonth.requiredScopes],
    arguments: [
      {
        name: "month",
        description: "1970-01 到 2100-12 的 YYYY-MM",
        required: true,
        variadic: false,
      },
    ],
    options: [calendarSourceTypeOption],
    inputSchema: null,
    outputSchema: calendarMonthOutputSchema,
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: [
      "sharge calendar month 2026-07",
      "sharge calendar month 2026-07 --timezone Asia/Shanghai --source-type all --json",
    ],
    handler: async (context) =>
      runCalendarMonth(context.runtime, context.arguments.month, {
        sourceType:
          typeof context.options["--source-type"] === "string"
            ? context.options["--source-type"]
            : undefined,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "calendar.list",
    path: ["calendar", "list"],
    description: "读取不超过 31 天的明确 Calendar 时间范围",
    requiredScopes: [...apiOperations.calendarList.requiredScopes],
    arguments: [],
    options: [
      {
        name: "--start",
        aliases: [],
        type: "string",
        description: "范围起点，必须是带显式 offset 的 RFC 3339",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
        required: true,
      },
      {
        name: "--end",
        aliases: [],
        type: "string",
        description: "范围终点，必须晚于 start 且带显式 offset",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
        required: true,
      },
      calendarSourceTypeOption,
    ],
    inputSchema: null,
    outputSchema: calendarRangeOutputSchema,
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: [
      "sharge calendar list --start 2026-07-30T00:00:00+08:00 --end 2026-08-01T00:00:00+08:00",
      "sharge calendar list --start 2026-07-30T00:00:00+08:00 --end 2026-08-01T00:00:00+08:00 --timezone Asia/Shanghai --json",
    ],
    handler: async (context) =>
      runCalendarList(context.runtime, {
        start:
          typeof context.options["--start"] === "string"
            ? context.options["--start"]
            : undefined,
        end:
          typeof context.options["--end"] === "string"
            ? context.options["--end"]
            : undefined,
        sourceType:
          typeof context.options["--source-type"] === "string"
            ? context.options["--source-type"]
            : undefined,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "calendar.search",
    path: ["calendar", "search"],
    description: "按标题搜索当前用户的正式 Calendar item",
    requiredScopes: [...apiOperations.calendarSearch.requiredScopes],
    arguments: [
      {
        name: "keyword",
        description: "必填标题搜索词",
        required: true,
        variadic: false,
      },
    ],
    options: [
      calendarSourceTypeOption,
      {
        name: "--limit",
        aliases: [],
        type: "string",
        description: "最大返回条数，1–100；默认 30",
        default: "30",
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
    ],
    inputSchema: null,
    outputSchema: calendarSearchOutputSchema,
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: [
      "sharge calendar search '项目评审'",
      "sharge calendar search '项目评审' --source-type manual --limit 20 --json",
    ],
    handler: async (context) =>
      runCalendarSearch(context.runtime, context.arguments.keyword, {
        sourceType:
          typeof context.options["--source-type"] === "string"
            ? context.options["--source-type"]
            : undefined,
        limit:
          typeof context.options["--limit"] === "string"
            ? context.options["--limit"]
            : undefined,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "calendar.get",
    path: ["calendar", "get"],
    description: "按 ID 读取一个正式 Calendar event 或 todo",
    requiredScopes: [...apiOperations.calendarGet.requiredScopes],
    arguments: [
      {
        name: "event-id",
        description: "Calendar item 正整数 ID",
        required: true,
        variadic: false,
      },
    ],
    options: [],
    inputSchema: null,
    outputSchema: calendarEventOutputSchema,
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: ["sharge calendar get 123", "sharge calendar get 123 --json"],
    handler: async (context) =>
      runCalendarGet(context.runtime, context.arguments["event-id"], {
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "calendar.create",
    path: ["calendar", "create"],
    description: "创建正式 Calendar event 或 todo",
    requiredScopes: [...apiOperations.calendarCreate.requiredScopes],
    arguments: [],
    options: calendarWriteOptions(false),
    inputSchema: calendarCreateInputJsonSchema,
    outputSchema: {
      anyOf: [calendarEventOutputSchema, dryRunPlanOutputSchema],
    },
    network: true,
    sideEffects: [
      "create_calendar_item",
      "create_calendar_instances",
      "schedule_calendar_alarm",
    ],
    destructive: false,
    dryRun: true,
    retrySafe: false,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: [
      "sharge calendar create --title '项目例会' --start-time 2026-08-03T10:00:00+08:00 --json",
      "sharge calendar create --input @event.json --dry-run --json",
      "sharge calendar create --generate-input",
    ],
    handler: async (context) =>
      runCalendarCreate(context.runtime, calendarWriteHandlerOptions(context)),
  },
  {
    command: "calendar.update",
    path: ["calendar", "update"],
    description: "使用完整 PUT 更新 Calendar event、todo 或重复实例",
    requiredScopes: [...apiOperations.calendarUpdate.requiredScopes],
    arguments: [
      {
        name: "event-id",
        description: "Calendar item 正整数 ID",
        required: true,
        variadic: false,
      },
    ],
    options: calendarWriteOptions(true),
    inputSchema: calendarUpdateInputJsonSchema,
    outputSchema: {
      anyOf: [calendarUpdateResultOutputSchema, dryRunPlanOutputSchema],
    },
    network: true,
    sideEffects: [
      "update_calendar_item",
      "update_calendar_instances",
      "reschedule_calendar_alarm",
    ],
    destructive: false,
    dryRun: true,
    retrySafe: false,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: [
      "sharge calendar update 123 --input @update.json --dry-run --json",
      "sharge calendar update 123 --input @update.json --json",
      "sharge calendar update 123 --generate-input",
    ],
    handler: async (context) =>
      runCalendarUpdate(
        context.runtime,
        context.arguments["event-id"],
        calendarWriteHandlerOptions(context),
      ),
  },
  {
    command: "calendar.delete",
    path: ["calendar", "delete"],
    description: "删除整个 Calendar item、当前实例或当前及未来实例",
    requiredScopes: [...apiOperations.calendarDelete.requiredScopes],
    arguments: [
      {
        name: "event-id",
        description: "Calendar item 正整数 ID",
        required: true,
        variadic: false,
      },
    ],
    options: [
      {
        name: "--type",
        aliases: [],
        type: "string",
        description: "删除范围：all、current 或 future",
        default: "all",
        enum: ["all", "current", "future"],
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--instance-id",
        aliases: [],
        type: "string",
        description: "服务端 opaque instance ID；current/future 必填",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--dry-run",
        aliases: [],
        type: "boolean",
        description: "只输出零网络删除计划，不要求 --yes",
        default: false,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
    ],
    inputSchema: null,
    outputSchema: {
      anyOf: [calendarUpdateResultOutputSchema, dryRunPlanOutputSchema],
    },
    network: true,
    sideEffects: [
      "delete_calendar_items",
      "delete_calendar_instances",
      "cancel_calendar_alarms",
    ],
    destructive: true,
    dryRun: true,
    retrySafe: false,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: [
      "sharge calendar delete 123 --type all --yes --json",
      "sharge calendar delete 123 --type future --instance-id opaque-id --dry-run --json",
    ],
    handler: async (context) =>
      runCalendarDelete(context.runtime, context.arguments["event-id"], {
        type:
          typeof context.options["--type"] === "string"
            ? context.options["--type"]
            : undefined,
        instanceId:
          typeof context.options["--instance-id"] === "string"
            ? context.options["--instance-id"]
            : undefined,
        yes: context.options["--yes"] === true,
        dryRun: context.options["--dry-run"] === true,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "calendar.todos",
    path: ["calendar", "todos"],
    description: "管理 Calendar Todo 状态",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: { type: "object" },
    network: false,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INVALID_COMMAND"],
    examples: [
      "sharge calendar todos --help",
      "sharge calendar todos --help --json",
    ],
    handler: null,
  },
  {
    command: "calendar.todos.set-status",
    path: ["calendar", "todos", "set-status"],
    description: "批量将 Calendar Todo 标记为已完成或未完成",
    requiredScopes: [...apiOperations.calendarTodoStatus.requiredScopes],
    arguments: [],
    options: [
      {
        name: "--event-id",
        aliases: [],
        type: "string",
        description: "目标 Todo 正整数 ID；可重复",
        default: null,
        enum: null,
        repeatable: true,
        exclusiveWith: ["--input", "--generate-input"],
      },
      {
        name: "--status",
        aliases: [],
        type: "string",
        description: "目标状态：completed 或 uncompleted",
        default: null,
        enum: ["completed", "uncompleted"],
        repeatable: false,
        exclusiveWith: ["--input", "--generate-input"],
      },
      {
        name: "--input",
        aliases: [],
        type: "string",
        description: "产品 JSON：inline、@file 或 -（stdin）",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: ["--event-id", "--status", "--generate-input"],
      },
      {
        name: "--generate-input",
        aliases: [],
        type: "boolean",
        description: "离线输出原始产品 JSON 模板",
        default: false,
        enum: null,
        repeatable: false,
        exclusiveWith: [
          "--event-id",
          "--status",
          "--input",
          "--dry-run",
          "--json",
          "--jq",
        ],
      },
      {
        name: "--dry-run",
        aliases: [],
        type: "boolean",
        description: "只输出零网络状态更新计划",
        default: false,
        enum: null,
        repeatable: false,
        exclusiveWith: ["--generate-input"],
      },
    ],
    inputSchema: calendarTodoStatusInputJsonSchema,
    outputSchema: {
      anyOf: [calendarTodoStatusOutputSchema, dryRunPlanOutputSchema],
    },
    network: true,
    sideEffects: ["update_calendar_todo_status"],
    destructive: false,
    dryRun: true,
    retrySafe: false,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: [
      "sharge calendar todos set-status --event-id 101 --event-id 102 --status completed --json",
      "sharge calendar todos set-status --input @status.json --dry-run --json",
      "sharge calendar todos set-status --generate-input",
    ],
    handler: async (context) =>
      runCalendarTodoSetStatus(context.runtime, {
        eventIds: Array.isArray(context.options["--event-id"])
          ? context.options["--event-id"]
          : typeof context.options["--event-id"] === "string"
            ? [context.options["--event-id"]]
            : [],
        status:
          typeof context.options["--status"] === "string"
            ? context.options["--status"]
            : undefined,
        input:
          typeof context.options["--input"] === "string"
            ? context.options["--input"]
            : undefined,
        generateInput: context.options["--generate-input"] === true,
        dryRun: context.options["--dry-run"] === true,
        json: context.options["--json"] === true,
        jq:
          typeof context.options["--jq"] === "string"
            ? context.options["--jq"]
            : undefined,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "recordings",
    path: ["recordings"],
    description: "只读访问 Recording",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: { type: "object" },
    network: false,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INVALID_COMMAND"],
    examples: ["sharge recordings --help", "sharge recordings --help --json"],
    handler: null,
  },
  {
    command: "recordings.list",
    path: ["recordings", "list"],
    description: "按 cursor、日期、类型和排序条件读取一页录音",
    requiredScopes: [...apiOperations.recordingsList.requiredScopes],
    arguments: [],
    options: [
      {
        name: "--cursor",
        aliases: [],
        type: "string",
        description: "上一页返回的 opaque 正整数 cursor",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--page-size",
        aliases: [],
        type: "string",
        description: "本页条数，1–50",
        default: "20",
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--direction",
        aliases: [],
        type: "string",
        description: "相对 cursor 的方向",
        default: "forward",
        enum: ["forward", "backward"],
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--start-date",
        aliases: [],
        type: "string",
        description: "本地日期下界（含），YYYY-MM-DD",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--end-date",
        aliases: [],
        type: "string",
        description: "本地日期上界（含），YYYY-MM-DD",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--recording-type",
        aliases: [],
        type: "string",
        description: "录音类型过滤",
        default: null,
        enum: ["ordinary", "call", "app_related"],
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--sort-by",
        aliases: [],
        type: "string",
        description: "排序字段",
        default: "timestamp",
        enum: ["created_at", "updated_at", "timestamp", "id"],
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--sort-order",
        aliases: [],
        type: "string",
        description: "排序方向",
        default: "desc",
        enum: ["asc", "desc"],
        repeatable: false,
        exclusiveWith: [],
      },
    ],
    inputSchema: null,
    outputSchema: recordingsPageOutputSchema,
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: {
      cursorField: "next_cursor",
      backwardCursorField: "prev_cursor",
      hasMoreField: "has_more",
      direction: ["forward", "backward"],
      automatic: false,
    },
    errors: calendarReadErrors,
    examples: [
      "sharge recordings list",
      "sharge recordings list --page-size 20 --timezone Asia/Shanghai --json",
      "sharge recordings list --cursor 456 --direction forward --json",
    ],
    handler: async (context) =>
      runRecordingsList(context.runtime, {
        cursor:
          typeof context.options["--cursor"] === "string"
            ? context.options["--cursor"]
            : undefined,
        pageSize:
          typeof context.options["--page-size"] === "string"
            ? context.options["--page-size"]
            : undefined,
        direction:
          typeof context.options["--direction"] === "string"
            ? context.options["--direction"]
            : undefined,
        startDate:
          typeof context.options["--start-date"] === "string"
            ? context.options["--start-date"]
            : undefined,
        endDate:
          typeof context.options["--end-date"] === "string"
            ? context.options["--end-date"]
            : undefined,
        recordingType:
          typeof context.options["--recording-type"] === "string"
            ? context.options["--recording-type"]
            : undefined,
        sortBy:
          typeof context.options["--sort-by"] === "string"
            ? context.options["--sort-by"]
            : undefined,
        sortOrder:
          typeof context.options["--sort-order"] === "string"
            ? context.options["--sort-order"]
            : undefined,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "recordings.search",
    path: ["recordings", "search"],
    description: "按标题和总结搜索录音",
    requiredScopes: [...apiOperations.recordingsSearch.requiredScopes],
    arguments: [
      {
        name: "keyword",
        description: "非空搜索词",
        required: true,
        variadic: false,
      },
    ],
    options: [
      {
        name: "--limit",
        aliases: [],
        type: "string",
        description: "最大返回条数，1–50",
        default: "20",
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--recording-type",
        aliases: [],
        type: "string",
        description: "录音类型过滤",
        default: null,
        enum: ["ordinary", "call", "app_related"],
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--language",
        aliases: [],
        type: "string",
        description: "总结语言过滤值",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--summary-template-id",
        aliases: [],
        type: "string",
        description: "总结模板 ID",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
    ],
    inputSchema: null,
    outputSchema: recordingsSearchOutputSchema,
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: [
      "sharge recordings search '项目复盘'",
      "sharge recordings search '项目复盘' --limit 20 --language zh --json",
    ],
    handler: async (context) =>
      runRecordingsSearch(context.runtime, context.arguments.keyword, {
        limit:
          typeof context.options["--limit"] === "string"
            ? context.options["--limit"]
            : undefined,
        recordingType:
          typeof context.options["--recording-type"] === "string"
            ? context.options["--recording-type"]
            : undefined,
        language:
          typeof context.options["--language"] === "string"
            ? context.options["--language"]
            : undefined,
        summaryTemplateId:
          typeof context.options["--summary-template-id"] === "string"
            ? context.options["--summary-template-id"]
            : undefined,
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "recordings.get",
    path: ["recordings", "get"],
    description: "按 ID 读取录音富详情、转写、总结、说话人和高光",
    requiredScopes: [...apiOperations.recordingsGet.requiredScopes],
    arguments: [
      {
        name: "recording-id",
        description: "录音正整数 ID",
        required: true,
        variadic: false,
      },
    ],
    options: [],
    inputSchema: null,
    outputSchema: recordingDetailOutputSchema,
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: [
      "sharge recordings get 456",
      "sharge recordings get 456 --json --jq '.data.transcript.text'",
    ],
    handler: async (context) =>
      runRecordingsGet(context.runtime, context.arguments["recording-id"], {
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "recordings.download",
    path: ["recordings", "download"],
    description: "将 Recording 音频安全下载到本地文件",
    requiredScopes: [...apiOperations.recordingsDownload.requiredScopes],
    arguments: [
      {
        name: "recording-id",
        description: "录音正整数 ID",
        required: true,
        variadic: false,
      },
    ],
    options: [
      {
        name: "--file",
        aliases: [],
        type: "string",
        description: "显式本地目标路径；不支持 -",
        default: null,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--overwrite",
        aliases: [],
        type: "boolean",
        description: "允许覆盖显式目标文件",
        default: false,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
      {
        name: "--dry-run",
        aliases: [],
        type: "boolean",
        description: "只输出零网络下载计划，不创建文件",
        default: false,
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
    ],
    inputSchema: null,
    outputSchema: {
      anyOf: [downloadResultOutputSchema, downloadDryRunOutputSchema],
    },
    network: true,
    sideEffects: ["write_download_file"],
    destructive: false,
    dryRun: true,
    retrySafe: true,
    timeout: 600_000,
    pagination: null,
    errors: [...calendarReadErrors, "FILE_EXISTS", "FILE_IO_ERROR"],
    examples: [
      "sharge recordings download 456",
      "sharge recordings download 456 --json",
      "sharge recordings download 456 --file ./meeting.m4a --overwrite --json",
      "sharge recordings download 456 --dry-run --json",
    ],
    handler: async (context) =>
      runRecordingsDownload(
        context.runtime,
        context.arguments["recording-id"],
        {
          file:
            typeof context.options["--file"] === "string"
              ? context.options["--file"]
              : undefined,
          overwrite: context.options["--overwrite"] === true,
          dryRun: context.options["--dry-run"] === true,
          json: context.options["--json"] === true,
          timeoutMs: parseTimeoutMs(
            typeof context.options["--timeout"] === "string"
              ? context.options["--timeout"]
              : undefined,
          ),
          timezoneOverride:
            typeof context.options["--timezone"] === "string"
              ? context.options["--timezone"]
              : undefined,
        },
      ),
  },
  {
    command: "diary",
    path: ["diary"],
    description: "只读访问 Diary（日记）",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: { type: "object" },
    network: false,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INVALID_COMMAND"],
    examples: ["sharge diary --help", "sharge diary --help --json"],
    handler: null,
  },
  {
    command: "diary.list",
    path: ["diary", "list"],
    description: "读取明确月份内已生成的日记",
    requiredScopes: [...apiOperations.diaryList.requiredScopes],
    arguments: [
      {
        name: "month",
        description: "明确月份 YYYY-MM",
        required: true,
        variadic: false,
      },
    ],
    options: [],
    inputSchema: null,
    outputSchema: { type: "array", items: diaryDocumentOutputSchema },
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: ["sharge diary list 2026-07", "sharge diary list 2026-07 --json"],
    handler: async (context) =>
      runDiaryList(context.runtime, context.arguments.month, {
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "diary.search",
    path: ["diary", "search"],
    description: "按标题和 Markdown 正文搜索日记",
    requiredScopes: [...apiOperations.diarySearch.requiredScopes],
    arguments: [
      {
        name: "keyword",
        description: "1–200 字符搜索词",
        required: true,
        variadic: false,
      },
    ],
    options: [
      {
        name: "--limit",
        aliases: [],
        type: "string",
        description: "最大返回数，1–100",
        default: "20",
        enum: null,
        repeatable: false,
        exclusiveWith: [],
      },
    ],
    inputSchema: null,
    outputSchema: {
      type: "array",
      items: {
        ...diaryDocumentOutputSchema,
        required: [
          ...diaryDocumentOutputSchema.required,
          "matched_fields",
          "matched_title",
          "matched_body_excerpt",
        ],
        properties: {
          ...diaryDocumentOutputSchema.properties,
          matched_fields: {
            type: "array",
            items: { type: "string", enum: ["title", "body"] },
          },
          matched_title: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          matched_body_excerpt: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
        },
      },
    },
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: [
      "sharge diary search 上海",
      "sharge diary search 上海 --limit 20 --json",
    ],
    handler: async (context) =>
      runDiarySearch(
        context.runtime,
        context.arguments.keyword,
        typeof context.options["--limit"] === "string"
          ? context.options["--limit"]
          : undefined,
        {
          timeoutMs: parseTimeoutMs(
            typeof context.options["--timeout"] === "string"
              ? context.options["--timeout"]
              : undefined,
          ),
          timezoneOverride:
            typeof context.options["--timezone"] === "string"
              ? context.options["--timezone"]
              : undefined,
        },
      ),
  },
  {
    command: "diary.get",
    path: ["diary", "get"],
    description: "按真实 YYYYMMDD 日期读取一篇日记与 Markdown",
    requiredScopes: [...apiOperations.diaryGet.requiredScopes],
    arguments: [
      {
        name: "identifier",
        description: "真实日记日期 YYYYMMDD",
        required: true,
        variadic: false,
      },
    ],
    options: [],
    inputSchema: null,
    outputSchema: diaryDetailOutputSchema,
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: calendarReadErrors,
    examples: [
      "sharge diary get 20260730",
      "sharge diary get 20260730 --json --jq '.data.markdown'",
    ],
    handler: async (context) =>
      runDiaryGet(context.runtime, context.arguments.identifier, {
        timeoutMs: parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        timezoneOverride:
          typeof context.options["--timezone"] === "string"
            ? context.options["--timezone"]
            : undefined,
      }),
  },
  {
    command: "auth",
    path: ["auth"],
    description: "鉴权状态与 scope",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: {
      type: "object",
      required: ["healthy", "checks"],
      properties: {
        healthy: { type: "boolean" },
        checks: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "status", "message"],
          },
        },
      },
    },
    network: false,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INVALID_COMMAND"],
    examples: ["sharge auth --help", "sharge auth --help --json"],
    handler: null,
  },
  {
    command: "config",
    path: ["config"],
    description: "配置与来源管理",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: {
      type: "object",
    },
    network: false,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INVALID_COMMAND"],
    examples: ["sharge config --help", "sharge config --help --json"],
    handler: null,
  },
  {
    command: "logs",
    path: ["logs"],
    description: "持久化日志管理",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: {
      type: "object",
    },
    network: false,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INVALID_COMMAND"],
    examples: ["sharge logs --help", "sharge logs --help --json"],
    handler: null,
  },
  {
    command: "version",
    path: ["version"],
    description: "显示 CLI 版本",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["version"],
      properties: {
        version: {
          type: "string",
        },
      },
    },
    network: false,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: [],
    examples: ["sharge version", "sharge version --json"],
    handler: async () => ({
      text: `${packageJson.version}\n`,
      data: {
        version: packageJson.version,
      },
    }),
  },
  {
    command: "doctor",
    path: ["doctor"],
    description: "诊断本地配置与 Open Platform 连通性",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: { type: "object" },
    network: true,
    sideEffects: ["repair_safe_permissions"],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: networkErrors,
    examples: ["sharge doctor", "sharge doctor --json"],
    handler: async (context) =>
      runDoctor(
        context.runtime,
        parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        typeof context.options["--timezone"] === "string"
          ? context.options["--timezone"]
          : undefined,
      ),
  },
  {
    command: "auth.status",
    path: ["auth", "status"],
    description: "验证凭证并显示身份",
    requiredScopes: [...apiOperations.authStatus.requiredScopes],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: {
      type: "object",
      required: ["credential", "auth"],
      properties: {
        credential: { type: "object" },
        auth: { type: "object" },
      },
    },
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: networkErrors,
    examples: ["sharge auth status", "sharge auth status --json"],
    handler: async (context) =>
      runAuthStatus(
        context.runtime,
        parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        typeof context.options["--timezone"] === "string"
          ? context.options["--timezone"]
          : undefined,
      ),
  },
  {
    command: "auth.scopes",
    path: ["auth", "scopes"],
    description: "显示 scope 目录与当前授权",
    requiredScopes: [...apiOperations.authScopes.requiredScopes],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: {
      type: "array",
      items: {
        type: "object",
        required: [
          "scope",
          "business_namespace",
          "access",
          "name",
          "description",
          "granted",
        ],
      },
    },
    network: true,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: 30_000,
    pagination: null,
    errors: networkErrors,
    examples: ["sharge auth scopes", "sharge auth scopes --json"],
    handler: async (context) =>
      runAuthScopes(
        context.runtime,
        parseTimeoutMs(
          typeof context.options["--timeout"] === "string"
            ? context.options["--timeout"]
            : undefined,
        ),
        typeof context.options["--timezone"] === "string"
          ? context.options["--timezone"]
          : undefined,
      ),
  },
  {
    command: "config.show",
    path: ["config", "show"],
    description: "显示 resolved 配置与来源",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: {
      type: "object",
    },
    network: false,
    sideEffects: ["create_settings_if_missing"],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INVALID_INPUT", "INTERNAL_ERROR"],
    examples: ["sharge config show", "sharge config show --json"],
    handler: async (context) =>
      runConfigShow(
        context.runtime,
        typeof context.options["--timezone"] === "string"
          ? context.options["--timezone"]
          : undefined,
      ),
  },
  {
    command: "config.set",
    path: ["config", "set"],
    description: "设置 base URL 或 timezone",
    requiredScopes: [],
    arguments: [
      {
        name: "key",
        description: "允许 base-url 或 timezone",
        required: true,
        variadic: false,
        enum: ["base-url", "timezone"],
      },
      {
        name: "value",
        description: "要保存的值",
        required: true,
        variadic: false,
      },
    ],
    options: [],
    inputSchema: null,
    outputSchema: {
      type: "object",
    },
    network: false,
    sideEffects: ["update_settings"],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INVALID_INPUT"],
    examples: [
      "sharge config set base-url https://api.example.test",
      "sharge config set timezone Asia/Shanghai",
    ],
    handler: async (context) =>
      runConfigSet(
        context.runtime,
        context.arguments.key,
        context.arguments.value,
      ),
  },
  {
    command: "config.unset",
    path: ["config", "unset"],
    description: "移除 settings 中的 base URL 或 timezone",
    requiredScopes: [],
    arguments: [
      {
        name: "key",
        description: "允许 base-url 或 timezone",
        required: true,
        variadic: false,
        enum: ["base-url", "timezone"],
      },
    ],
    options: [],
    inputSchema: null,
    outputSchema: {
      type: "object",
    },
    network: false,
    sideEffects: ["update_settings"],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INVALID_INPUT"],
    examples: ["sharge config unset base-url", "sharge config unset timezone"],
    handler: async (context) =>
      runConfigUnset(context.runtime, context.arguments.key),
  },
  {
    command: "logs.path",
    path: ["logs", "path"],
    description: "显示持久化日志文件的绝对路径",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: {
      type: "object",
    },
    network: false,
    sideEffects: [],
    destructive: false,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: [],
    examples: ["sharge logs path", "sharge logs path --json"],
    handler: async (context) => runLogsPath(context.runtime),
  },
  {
    command: "logs.clear",
    path: ["logs", "clear"],
    description: "清理当前和轮转日志",
    requiredScopes: [],
    arguments: [],
    options: [],
    inputSchema: null,
    outputSchema: {
      type: "object",
    },
    network: false,
    sideEffects: ["delete_local_logs"],
    destructive: true,
    dryRun: false,
    retrySafe: true,
    timeout: null,
    pagination: null,
    errors: ["INVALID_INPUT"],
    examples: ["sharge logs clear --yes", "sharge logs clear --yes --json"],
    handler: async (context) =>
      runLogsClear(context.runtime, {
        yes: context.options["--yes"] === true,
        json: context.options["--json"] === true,
      }),
  },
];

export function inheritedOptions(
  definition: CommandDefinition,
): OptionDefinition[] {
  if (definition.command === rootCommandDefinition.command) {
    return definition.options;
  }
  const globalOptions =
    definition.command === "login" || definition.command.endsWith(".download")
      ? rootCommandDefinition.options.map((option) =>
          option.name === "--timeout"
            ? {
                ...option,
                default: definition.command === "login" ? null : "10m",
                description:
                  definition.command === "login"
                    ? "登录总超时；省略时使用服务端授权有效期，显式值只能缩短等待"
                    : "下载总超时；默认 10m，必须使用 s 或 m 单位",
              }
            : option,
        )
      : rootCommandDefinition.options;
  return [...globalOptions, ...definition.options];
}

export function commandHelpData(definition: CommandDefinition) {
  return {
    command: definition.command,
    description: definition.description,
    requiredScopes: definition.requiredScopes,
    arguments: definition.arguments,
    options: inheritedOptions(definition),
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    network: definition.network,
    sideEffects: definition.sideEffects,
    destructive: definition.destructive,
    dryRun: definition.dryRun,
    retrySafe: definition.retrySafe,
    timeout: definition.timeout,
    pagination: definition.pagination,
    errors: definition.errors,
    examples: definition.examples,
  };
}

export function findCommandDefinition(
  path: string[],
  definitions = commandDefinitions,
): CommandDefinition | undefined {
  return definitions.find(
    (definition) =>
      definition.path.length === path.length &&
      definition.path.every((part, index) => part === path[index]),
  );
}

export function resolveCommandDefinition(
  positionals: string[],
  definitions = commandDefinitions,
): CommandDefinition | undefined {
  return definitions
    .filter(
      (definition) =>
        positionals.length >= definition.path.length &&
        definition.path.every((part, index) => part === positionals[index]),
    )
    .sort((left, right) => right.path.length - left.path.length)[0];
}
