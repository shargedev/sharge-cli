export type ApiOperation = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  openApiPath: string;
  requiredScopes: string[];
  requestSchemaRef: string | null;
  responseSchemaRef: string | null;
  successStatus?: string;
};

export const apiOperations = {
  authStatus: {
    method: "GET",
    path: "/open-api/v1/auth/status",
    openApiPath: "/auth/status",
    requiredScopes: [],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_OpenApiAuthStatusDTO_",
  },
  authScopes: {
    method: "GET",
    path: "/open-api/v1/auth/scopes",
    openApiPath: "/auth/scopes",
    requiredScopes: [],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_list_OpenApiScopeCatalogItemDTO__",
  },
  notesList: {
    method: "GET",
    path: "/open-api/v1/user-memory/quick-notes",
    openApiPath: "/user-memory/quick-notes",
    requiredScopes: ["quick_notes:read"],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_OpenApiQuickNotePageDTO_",
  },
  notesGet: {
    method: "GET",
    path: "/open-api/v1/user-memory/quick-notes/{note_id}",
    openApiPath: "/user-memory/quick-notes/{note_id}",
    requiredScopes: ["quick_notes:read"],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_OpenApiQuickNoteDTO_",
  },
  notesUpdate: {
    method: "PATCH",
    path: "/open-api/v1/user-memory/quick-notes/{note_id}",
    openApiPath: "/user-memory/quick-notes/{note_id}",
    requiredScopes: ["quick_notes:write"],
    requestSchemaRef: "#/components/schemas/UpdateQuickNoteRequestDTO",
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_OpenApiQuickNoteDTO_",
  },
  notesDelete: {
    method: "DELETE",
    path: "/open-api/v1/user-memory/quick-notes/{note_id}",
    openApiPath: "/user-memory/quick-notes/{note_id}",
    requiredScopes: ["quick_notes:write"],
    requestSchemaRef: null,
    responseSchemaRef: "#/components/schemas/OpenApiResponse_NoneType_",
  },
  notesDownload: {
    method: "GET",
    path: "/open-api/v1/user-memory/quick-notes/{note_id}/media/{media_type}/download",
    openApiPath:
      "/user-memory/quick-notes/{note_id}/media/{media_type}/download",
    requiredScopes: ["quick_notes:read"],
    requestSchemaRef: null,
    responseSchemaRef: null,
    successStatus: "307",
  },
  calendarMonth: {
    method: "GET",
    path: "/open-api/v1/ai-calendar/events/monthly",
    openApiPath: "/ai-calendar/events/monthly",
    requiredScopes: ["calendar:read"],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_OpenApiCalendarMonthlyDTO_",
  },
  calendarList: {
    method: "GET",
    path: "/open-api/v1/ai-calendar/events",
    openApiPath: "/ai-calendar/events",
    requiredScopes: ["calendar:read"],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_OpenApiCalendarRangeDTO_",
  },
  calendarSearch: {
    method: "GET",
    path: "/open-api/v1/ai-calendar/events/search",
    openApiPath: "/ai-calendar/events/search",
    requiredScopes: ["calendar:read"],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_list_OpenApiCalendarSearchResultDTO__",
  },
  calendarGet: {
    method: "GET",
    path: "/open-api/v1/ai-calendar/events/{event_id}",
    openApiPath: "/ai-calendar/events/{event_id}",
    requiredScopes: ["calendar:read"],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_OpenApiCalendarEventDTO_",
  },
  calendarCreate: {
    method: "POST",
    path: "/open-api/v1/ai-calendar/events",
    openApiPath: "/ai-calendar/events",
    requiredScopes: ["calendar:write"],
    requestSchemaRef: "#/components/schemas/CreateCalendarEventRequestDTO",
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_OpenApiCalendarEventDTO_",
    successStatus: "201",
  },
  calendarUpdate: {
    method: "PUT",
    path: "/open-api/v1/ai-calendar/events/{event_id}",
    openApiPath: "/ai-calendar/events/{event_id}",
    requiredScopes: ["calendar:write"],
    requestSchemaRef: "#/components/schemas/UpdateCalendarEventRequestDTO",
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_OpenApiCalendarUpdateResultDTO_",
  },
  calendarDelete: {
    method: "DELETE",
    path: "/open-api/v1/ai-calendar/events/{event_id}",
    openApiPath: "/ai-calendar/events/{event_id}",
    requiredScopes: ["calendar:write"],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_OpenApiCalendarUpdateResultDTO_",
  },
  calendarTodoStatus: {
    method: "PATCH",
    path: "/open-api/v1/ai-calendar/todos/status",
    openApiPath: "/ai-calendar/todos/status",
    requiredScopes: ["calendar:write"],
    requestSchemaRef: "#/components/schemas/UpdateTodoStatusRequestDTO",
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_UpdateTodoStatusResultDTO_",
  },
  recordingsList: {
    method: "GET",
    path: "/open-api/v1/voicemaster/recordings",
    openApiPath: "/voicemaster/recordings",
    requiredScopes: ["voicemaster:read"],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_OpenApiRecordingPageDTO_",
  },
  recordingsSearch: {
    method: "GET",
    path: "/open-api/v1/voicemaster/recordings/search",
    openApiPath: "/voicemaster/recordings/search",
    requiredScopes: ["voicemaster:read"],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_list_OpenApiRecordingSearchDTO__",
  },
  recordingsGet: {
    method: "GET",
    path: "/open-api/v1/voicemaster/recordings/{recording_id}",
    openApiPath: "/voicemaster/recordings/{recording_id}",
    requiredScopes: ["voicemaster:read"],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_OpenApiRecordingDetailDTO_",
  },
  recordingsDownload: {
    method: "GET",
    path: "/open-api/v1/voicemaster/recordings/{recording_id}/audio/download",
    openApiPath: "/voicemaster/recordings/{recording_id}/audio/download",
    requiredScopes: ["voicemaster:read"],
    requestSchemaRef: null,
    responseSchemaRef: null,
    successStatus: "307",
  },
  diaryList: {
    method: "GET",
    path: "/open-api/v1/ai-daily/reports/daily",
    openApiPath: "/ai-daily/reports/daily",
    requiredScopes: ["ai_daily:read"],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_list_OpenApiDailyReportDocumentDTO__",
  },
  diarySearch: {
    method: "GET",
    path: "/open-api/v1/ai-daily/reports/search",
    openApiPath: "/ai-daily/reports/search",
    requiredScopes: ["ai_daily:read"],
    requestSchemaRef: null,
    responseSchemaRef:
      "#/components/schemas/OpenApiResponse_list_OpenApiDailyReportSearchDTO__",
  },
  diaryGet: {
    method: "GET",
    path: "/open-api/v1/ai-daily/reports/{report_type}/{identifier}",
    openApiPath: "/ai-daily/reports/{report_type}/{identifier}",
    requiredScopes: ["ai_daily:read"],
    requestSchemaRef: null,
    responseSchemaRef: "#/components/schemas/OpenApiResponse_OpenApiReportDTO_",
  },
} as const satisfies Record<string, ApiOperation>;
